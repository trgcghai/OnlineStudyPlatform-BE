import { Test, TestingModule } from '@nestjs/testing';
import { Workbook } from 'exceljs';
import { LessonImportRow, ZipService, ZipValidationError } from './zip.service';

describe('ZipService', () => {
  let service: ZipService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ZipService],
    }).compile();

    service = module.get(ZipService);
  });

  it('parses lesson rows in workbook order and reports duplicate orders', async () => {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Lessons');
    sheet.addRow([
      'order',
      'title',
      'description',
      'video_filename',
      'material_filename',
    ]);
    sheet.addRow([2, 'Second', '', '', 'notes.pdf']);
    sheet.addRow([1, 'First', '', 'intro.mp4', '']);
    const internals = service as unknown as {
      parseLessonWorkbook(buffer: Buffer): Promise<LessonImportRow[]>;
    };

    const rows = await internals.parseLessonWorkbook(
      Buffer.from(await workbook.xlsx.writeBuffer()),
    );
    expect(rows.map((row) => row.title)).toEqual(['First', 'Second']);

    sheet.addRow([1, 'Duplicate', '', '', '']);
    await expect(
      internals.parseLessonWorkbook(
        Buffer.from(await workbook.xlsx.writeBuffer()),
      ),
    ).rejects.toMatchObject({
      details: expect.arrayContaining([
        expect.stringContaining('order must be unique'),
      ]),
    });
  });

  it('reports unsupported and missing referenced files', () => {
    const internals = service as unknown as {
      validateReferences(
        rows: LessonImportRow[],
        entries: object[],
      ): Map<string, object>;
    };
    const rows: LessonImportRow[] = [
      {
        rowNumber: 2,
        order: 1,
        title: 'Lesson',
        description: '',
        videoFilename: 'clip.avi',
        materialFilename: 'missing.pdf',
      },
    ];

    expect(() => internals.validateReferences(rows, [])).toThrow(
      ZipValidationError,
    );
    try {
      internals.validateReferences(rows, []);
    } catch (error) {
      expect((error as ZipValidationError).details).toEqual(
        expect.arrayContaining([
          expect.stringContaining('must use one of: .mp4, .webm, .mkv'),
          expect.stringContaining('references missing file'),
        ]),
      );
    }
  });

  it('accepts MKV videos within the import archive', () => {
    const internals = service as unknown as {
      validateReferences(
        rows: LessonImportRow[],
        entries: object[],
      ): Map<string, object>;
    };
    const rows: LessonImportRow[] = [
      {
        rowNumber: 2,
        order: 1,
        title: 'Lesson',
        description: '',
        videoFilename: 'lecture.mkv',
        materialFilename: null,
      },
    ];

    expect(
      internals.validateReferences(rows, [
        {
          normalizedPath: 'videos/lecture.mkv',
          directory: false,
          uncompressedSize: 1,
        },
      ]),
    ).toHaveProperty('size', 1);
  });

  it('rejects unsafe archive paths', () => {
    const internals = service as unknown as {
      normalizePath(path: string, directory: boolean): string;
    };

    expect(() => internals.normalizePath('../lessons.xlsx', false)).toThrow(
      ZipValidationError,
    );
  });
});
