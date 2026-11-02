import { Injectable } from '@nestjs/common';
import { Workbook, Worksheet } from 'exceljs';
import { createReadStream } from 'node:fs';
import { mkdir, open, readFile, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Readable } from 'node:stream';
import {
  createExtractorFromFile,
  type Extractor,
  type FileHeader,
} from 'node-unrar-js';
import * as yauzl from 'yauzl';
import {
  LESSON_IMPORT_EXCEL_MAX_SIZE_BYTES,
  LESSON_IMPORT_MAX_ENTRIES,
  LESSON_IMPORT_MAX_EXTRACTED_SIZE_BYTES,
  LESSON_IMPORT_MAX_LESSONS,
  LESSON_MATERIAL_MAX_SIZE_BYTES,
  LESSON_VIDEO_MAX_SIZE_BYTES,
} from '../../common/constants/file.constant';

export interface LessonImportRow {
  rowNumber: number;
  order: number;
  title: string;
  description: string;
  videoFilename: string | null;
  materialFilename: string | null;
}

export interface LessonZipAsset {
  path: string;
  uncompressedSize: number;
  entry: yauzl.Entry;
}

export interface LessonRarAsset {
  path: string;
  uncompressedSize: number;
  entryName: string;
}

export type LessonImportAsset = LessonZipAsset | LessonRarAsset;

interface ImportEntry {
  path: string;
  uncompressedSize: number;
  normalizedPath: string;
  directory: boolean;
  encrypted: boolean;
}

interface ZipImportEntry extends ImportEntry {
  entry: yauzl.Entry;
}

interface RarImportEntry extends ImportEntry {
  entryName: string;
}

export interface LessonImportArchive {
  readonly rows: LessonImportRow[];
  readonly referencedFileCount: number;
  getAsset(folder: 'videos' | 'materials', filename: string): LessonImportAsset;
  openStream(asset: LessonImportAsset): Promise<Readable>;
  close(): void | Promise<void>;
}

const HEADERS = [
  'order',
  'title',
  'description',
  'video_filename',
  'material_filename',
] as const;

export class ZipValidationError extends Error {
  constructor(readonly details: string[]) {
    super('Lesson import archive validation failed');
  }
}

export class LessonZipArchive implements LessonImportArchive {
  constructor(
    private readonly zip: yauzl.ZipFile,
    readonly rows: LessonImportRow[],
    private readonly referenced: Map<string, ZipImportEntry>,
  ) {}

  get referencedFileCount(): number {
    return this.referenced.size;
  }

  getAsset(folder: 'videos' | 'materials', filename: string): LessonZipAsset {
    const path = `${folder}/${filename}`.toLowerCase();
    const asset = this.referenced.get(path);
    if (!asset) throw new Error(`Validated ZIP asset is missing: ${path}`);
    return asset;
  }

  openStream(asset: LessonImportAsset): Promise<Readable> {
    if (!('entry' in asset)) {
      throw new Error('ZIP archive received a RAR asset');
    }
    return openEntryStream(this.zip, asset.entry);
  }

  close(): void {
    this.zip.close();
  }
}

class LessonRarArchive implements LessonImportArchive {
  constructor(
    private readonly extractor: Extractor,
    private readonly extractionPath: string,
    readonly rows: LessonImportRow[],
    private readonly referenced: Map<string, RarImportEntry>,
  ) {}

  get referencedFileCount(): number {
    return this.referenced.size;
  }

  getAsset(folder: 'videos' | 'materials', filename: string): LessonRarAsset {
    const path = `${folder}/${filename}`.toLowerCase();
    const asset = this.referenced.get(path);
    if (!asset) throw new Error(`Validated RAR asset is missing: ${path}`);
    return asset;
  }

  async openStream(asset: LessonImportAsset): Promise<Readable> {
    if (!('entryName' in asset)) {
      throw new Error('RAR archive received a ZIP asset');
    }
    await mkdir(this.extractionPath, { recursive: true });
    Array.from(this.extractor.extract({ files: [asset.entryName] }).files);
    return createReadStream(join(this.extractionPath, asset.path));
  }

  close(): Promise<void> {
    return rm(this.extractionPath, { recursive: true, force: true });
  }
}

@Injectable()
export class ZipService {
  async openLessonImport(path: string): Promise<LessonImportArchive> {
    if (extname(path).toLowerCase() === '.rar') {
      return this.openRar(path);
    }
    await this.assertNotZip64(path);
    const zip = await this.openZip(path);
    try {
      const entries = await this.readEntries(zip);
      const workbookEntry = this.validateArchive(entries, 'ZIP');
      const workbookBuffer = await this.readEntryBuffer(
        zip,
        workbookEntry.entry,
        LESSON_IMPORT_EXCEL_MAX_SIZE_BYTES,
      );
      const rows = await this.parseLessonWorkbook(workbookBuffer);
      const referenced = this.validateReferences(rows, entries);
      return new LessonZipArchive(zip, rows, referenced);
    } catch (error) {
      zip.close();
      throw error;
    }
  }

  private async openRar(path: string): Promise<LessonRarArchive> {
    const extractionPath = `${path}.extract`;
    try {
      const extractor = await createExtractorFromFile({
        filepath: path,
        targetPath: extractionPath,
        filenameTransform: (filename) =>
          this.normalizePath(
            filename,
            filename.endsWith('/') || filename.endsWith('\\'),
            true,
          ),
      });
      const fileList = extractor.getFileList();
      const entries = this.readRarEntries(
        fileList.arcHeader.flags,
        fileList.fileHeaders,
      );
      const workbookEntry = this.validateArchive(entries, 'RAR');
      const workbookBuffer = await this.readRarEntryBuffer(
        extractor,
        extractionPath,
        workbookEntry,
      );
      const rows = await this.parseLessonWorkbook(workbookBuffer);
      const referenced = this.validateReferences(rows, entries);
      return new LessonRarArchive(extractor, extractionPath, rows, referenced);
    } catch (error) {
      await rm(extractionPath, { recursive: true, force: true });
      if (error instanceof ZipValidationError) throw error;
      throw new ZipValidationError([
        error instanceof Error ? error.message : 'Invalid RAR archive',
      ]);
    }
  }

  private readRarEntries(
    archiveFlags: { headerEncrypted: boolean; volume: boolean },
    headers: Generator<FileHeader>,
  ): RarImportEntry[] {
    const details: string[] = [];
    if (archiveFlags.headerEncrypted) {
      details.push('RAR archive headers must not be encrypted');
    }
    if (archiveFlags.volume) {
      details.push('RAR multi-volume archives are not supported');
    }
    const entries: RarImportEntry[] = [];
    const usedPaths = new Set<string>();
    let extractedSize = 0;
    for (const header of headers) {
      const directory = header.flags.directory || /[\\/]$/.test(header.name);
      const normalizedPath = this.normalizePath(header.name, directory, true);
      if (usedPaths.has(normalizedPath)) {
        details.push(`Duplicate RAR path: ${header.name}`);
        continue;
      }
      usedPaths.add(normalizedPath);
      if (header.flags.encrypted) {
        details.push(`${header.name} must not be encrypted`);
      }
      const uncompressedSize = Number(header.unpSize);
      entries.push({
        entryName: header.name,
        path: normalizedPath,
        normalizedPath,
        directory,
        encrypted: header.flags.encrypted,
        uncompressedSize,
      });
      extractedSize += uncompressedSize;
      if (entries.length > LESSON_IMPORT_MAX_ENTRIES) {
        details.push(
          `RAR archive must contain at most ${LESSON_IMPORT_MAX_ENTRIES} entries`,
        );
        break;
      }
      if (extractedSize > LESSON_IMPORT_MAX_EXTRACTED_SIZE_BYTES) {
        details.push('Extracted RAR content must be at most 2 GB');
        break;
      }
    }
    this.throwIfInvalid(details);
    if (!entries.length) {
      throw new ZipValidationError(['RAR archive must not be empty']);
    }
    return entries;
  }

  private async readRarEntryBuffer(
    extractor: Extractor,
    extractionPath: string,
    entry: RarImportEntry,
  ): Promise<Buffer> {
    Array.from(extractor.extract({ files: [entry.entryName] }).files);
    const buffer = await readFile(join(extractionPath, entry.normalizedPath));
    if (buffer.length > LESSON_IMPORT_EXCEL_MAX_SIZE_BYTES) {
      throw new ZipValidationError(['lessons.xlsx must be at most 2 MB']);
    }
    return buffer;
  }

  private validateArchive<T extends ImportEntry>(
    entries: T[],
    archiveType: 'ZIP' | 'RAR',
  ): T {
    const details: string[] = [];
    const files = entries.filter((entry) => !entry.directory);
    const workbooks = files.filter((entry) =>
      entry.normalizedPath.endsWith('.xlsx'),
    );
    if (workbooks.length !== 1) {
      details.push(`${archiveType} must contain exactly one .xlsx workbook`);
    } else if (workbooks[0].normalizedPath !== 'lessons.xlsx') {
      details.push('The workbook must be named lessons.xlsx at the ZIP root');
    }
    for (const item of entries) {
      if (item.encrypted) {
        details.push(`${item.path} must not be encrypted`);
      }
      if (item.directory) {
        if (!['videos', 'materials'].includes(item.normalizedPath)) {
          details.push(`Unexpected directory: ${item.path}`);
        }
      } else if (
        item.normalizedPath !== 'lessons.xlsx' &&
        !/^videos\/[^/]+$/.test(item.normalizedPath) &&
        !/^materials\/[^/]+$/.test(item.normalizedPath)
      ) {
        details.push(`Unexpected file path: ${item.path}`);
      }
      if (
        !item.directory &&
        ['.zip', '.rar'].some((extension) =>
          item.normalizedPath.endsWith(extension),
        )
      ) {
        details.push(`Nested archives are not supported: ${item.path}`);
      }
    }
    const workbook = workbooks[0];
    if (
      workbook &&
      workbook.uncompressedSize > LESSON_IMPORT_EXCEL_MAX_SIZE_BYTES
    ) {
      details.push('lessons.xlsx must be at most 2 MB');
    }
    this.throwIfInvalid(details);
    return workbook;
  }

  private validateReferences<T extends ImportEntry>(
    rows: LessonImportRow[],
    entries: T[],
  ): Map<string, T> {
    const details: string[] = [];
    const byPath = new Map<string, T>(
      entries.map((entry) => [entry.normalizedPath, entry]),
    );
    const referenced = new Map<string, T>();
    for (const row of rows) {
      this.validateReference(
        row,
        'videos',
        row.videoFilename,
        ['.mp4', '.webm', '.mkv'],
        LESSON_VIDEO_MAX_SIZE_BYTES,
        byPath,
        referenced,
        details,
      );
      this.validateReference(
        row,
        'materials',
        row.materialFilename,
        ['.pdf', '.docx', '.pptx'],
        LESSON_MATERIAL_MAX_SIZE_BYTES,
        byPath,
        referenced,
        details,
      );
    }
    for (const item of entries) {
      if (
        !item.directory &&
        item.normalizedPath !== 'lessons.xlsx' &&
        !referenced.has(item.normalizedPath)
      ) {
        details.push(`Unreferenced file is not allowed: ${item.path}`);
      }
    }
    this.throwIfInvalid(details);
    return referenced;
  }

  private validateReference<T extends ImportEntry>(
    row: LessonImportRow,
    folder: 'videos' | 'materials',
    filename: string | null,
    extensions: string[],
    maxSize: number,
    entries: Map<string, T>,
    referenced: Map<string, T>,
    details: string[],
  ): void {
    if (!filename) return;
    const label = `Lessons!${row.rowNumber} ${folder === 'videos' ? 'video_filename' : 'material_filename'}`;
    if (!extensions.includes(extname(filename).toLowerCase())) {
      details.push(`${label} must use one of: ${extensions.join(', ')}`);
      return;
    }
    const path = this.referencePath(folder, filename);
    const entry = entries.get(path);
    if (!entry || entry.directory) {
      details.push(`${label} references missing file: ${folder}/${filename}`);
      return;
    }
    if (entry.uncompressedSize > maxSize) {
      details.push(
        `${label} exceeds the ${folder === 'videos' ? '200 MB' : '20 MB'} size limit`,
      );
    }
    referenced.set(path, entry);
  }

  private async parseLessonWorkbook(
    buffer: Buffer,
  ): Promise<LessonImportRow[]> {
    const workbook = new Workbook();
    try {
      await workbook.xlsx.load(buffer as never);
    } catch {
      throw new ZipValidationError(['lessons.xlsx must be a valid workbook']);
    }
    const sheet = workbook.getWorksheet('Lessons');
    if (!sheet) {
      throw new ZipValidationError(['Missing required sheet: Lessons']);
    }
    const details: string[] = [];
    const columns: Record<string, number> = {};
    sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, index) => {
      const header = cell.text
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_');
      if (header) columns[header] = index;
    });
    for (const header of HEADERS) {
      if (!columns[header])
        details.push(`Lessons!1 Missing required column: ${header}`);
    }
    const rows: LessonImportRow[] = [];
    const orders = new Set<number>();
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      if (HEADERS.every((header) => !this.cellText(row, columns[header])))
        continue;
      if (rows.length >= LESSON_IMPORT_MAX_LESSONS) {
        details.push(
          `Lessons!${rowNumber} import supports at most ${LESSON_IMPORT_MAX_LESSONS} lessons`,
        );
        continue;
      }
      const rawOrder = this.cellText(row, columns.order).trim();
      const order = Number(rawOrder);
      if (!rawOrder || !Number.isSafeInteger(order) || order < 1) {
        details.push(`Lessons!${rowNumber} order must be a positive integer`);
      } else if (orders.has(order)) {
        details.push(`Lessons!${rowNumber} order must be unique in this file`);
      }
      orders.add(order);
      const title = this.cellText(row, columns.title).trim();
      const description = this.cellText(row, columns.description).trim();
      if (!title || title.length > 200)
        details.push(
          `Lessons!${rowNumber} title must be between 1 and 200 characters`,
        );
      if (description.length > 5000)
        details.push(
          `Lessons!${rowNumber} description must not exceed 5000 characters`,
        );
      rows.push({
        rowNumber,
        order: Number.isSafeInteger(order) ? order : Number.MAX_SAFE_INTEGER,
        title,
        description,
        videoFilename: this.filename(
          this.cellText(row, columns.video_filename),
          `Lessons!${rowNumber} video_filename`,
          details,
        ),
        materialFilename: this.filename(
          this.cellText(row, columns.material_filename),
          `Lessons!${rowNumber} material_filename`,
          details,
        ),
      });
    }
    if (!rows.length) details.push('Lessons!2 At least one lesson is required');
    this.throwIfInvalid(details);
    return rows.sort((left, right) => left.order - right.order);
  }

  private openZip(path: string): Promise<yauzl.ZipFile> {
    return new Promise((resolve, reject) =>
      yauzl.open(path, { lazyEntries: true, autoClose: false }, (error, zip) =>
        error || !zip
          ? reject(error ?? new Error('Invalid ZIP'))
          : resolve(zip),
      ),
    );
  }

  private async assertNotZip64(path: string): Promise<void> {
    const handle = await open(path, 'r');
    try {
      const stats = await handle.stat();
      const size = Math.min(stats.size, 65_577);
      const buffer = Buffer.alloc(size);
      await handle.read(buffer, 0, size, stats.size - size);
      for (let offset = 0; offset <= buffer.length - 4; offset += 1) {
        const signature = buffer.readUInt32LE(offset);
        if (signature === 0x06064b50 || signature === 0x07064b50) {
          throw new ZipValidationError(['ZIP64 archives are not supported']);
        }
      }
    } finally {
      await handle.close();
    }
  }

  private readEntries(zip: yauzl.ZipFile): Promise<ZipImportEntry[]> {
    return new Promise((resolve, reject) => {
      const entries: ZipImportEntry[] = [];
      const usedPaths = new Set<string>();
      let extractedSize = 0;
      let settled = false;
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        reject(error instanceof Error ? error : new Error(String(error)));
      };
      zip.on('error', fail);
      zip.on('entry', (entry: yauzl.Entry) => {
        if (settled) return;
        try {
          const directory = entry.fileName.endsWith('/');
          const normalized = this.normalizePath(entry.fileName, directory);
          if (usedPaths.has(normalized)) {
            fail(
              new ZipValidationError([`Duplicate ZIP path: ${entry.fileName}`]),
            );
            return;
          }
          usedPaths.add(normalized);
          entries.push({
            entry,
            path: entry.fileName,
            normalizedPath: normalized,
            directory,
            encrypted: (entry.generalPurposeBitFlag & 0x1) !== 0,
            uncompressedSize: entry.uncompressedSize,
          });
          extractedSize += entry.uncompressedSize;
          if (entries.length > LESSON_IMPORT_MAX_ENTRIES) {
            fail(
              new ZipValidationError([
                `ZIP archive must contain at most ${LESSON_IMPORT_MAX_ENTRIES} entries`,
              ]),
            );
            return;
          }
          if (extractedSize > LESSON_IMPORT_MAX_EXTRACTED_SIZE_BYTES) {
            fail(
              new ZipValidationError([
                'Extracted ZIP content must be at most 2 GB',
              ]),
            );
            return;
          }
          zip.readEntry();
        } catch (error) {
          fail(error);
        }
      });
      zip.on('end', () => {
        if (settled) return;
        settled = true;
        if (entries.length) resolve(entries);
        else reject(new ZipValidationError(['ZIP archive must not be empty']));
      });
      zip.readEntry();
    });
  }

  private async readEntryBuffer(
    zip: yauzl.ZipFile,
    entry: yauzl.Entry,
    maxSize: number,
  ): Promise<Buffer> {
    const stream = await openEntryStream(zip, entry);
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxSize) {
          stream.destroy();
          reject(new ZipValidationError(['lessons.xlsx must be at most 2 MB']));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
  }

  private normalizePath(
    path: string,
    directory: boolean,
    allowWindowsSeparators = false,
  ): string {
    const normalizedSeparators = allowWindowsSeparators
      ? path.replaceAll('\\', '/')
      : path;
    const withoutSlash =
      directory && normalizedSeparators.endsWith('/')
        ? normalizedSeparators.slice(0, -1)
        : normalizedSeparators;
    if (
      !withoutSlash ||
      normalizedSeparators.startsWith('/') ||
      /^[a-z]:/i.test(normalizedSeparators) ||
      withoutSlash
        .split('/')
        .some((part) => !part || part === '.' || part === '..')
    ) {
      throw new ZipValidationError([
        `Unsafe archive path: ${path || '(empty path)'}`,
      ]);
    }
    return withoutSlash.toLowerCase();
  }

  private filename(
    value: string,
    label: string,
    details: string[],
  ): string | null {
    const filename = value.trim();
    if (!filename) return null;
    if (
      filename === '.' ||
      filename === '..' ||
      filename.includes('/') ||
      filename.includes('\\') ||
      /^[a-z][a-z0-9+.-]*:/i.test(filename)
    ) {
      details.push(`${label} must contain a filename only`);
      return null;
    }
    return filename;
  }

  private cellText(
    row: ReturnType<Worksheet['getRow']>,
    column?: number,
  ): string {
    return column ? row.getCell(column).text : '';
  }

  private referencePath(folder: string, filename: string): string {
    return `${folder}/${filename}`.toLowerCase();
  }

  private throwIfInvalid(details: string[]): void {
    if (details.length) throw new ZipValidationError(details);
  }
}

function openEntryStream(
  zip: yauzl.ZipFile,
  entry: yauzl.Entry,
): Promise<Readable> {
  return new Promise((resolve, reject) =>
    zip.openReadStream(entry, (error, stream) =>
      error || !stream
        ? reject(error ?? new Error('Could not read ZIP entry'))
        : resolve(stream),
    ),
  );
}
