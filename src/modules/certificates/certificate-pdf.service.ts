import { Injectable } from '@nestjs/common';
import {
  PDFDocument,
  PDFFont,
  PDFPage,
  RGB,
  StandardFonts,
  rgb,
} from 'pdf-lib';
import { Certificate } from './entities/certificate.entity';

const PAGE_WIDTH = 842;
const PAGE_HEIGHT = 595;
const CONTENT_WIDTH = 660;
const NAVY = rgb(0.09, 0.16, 0.26);
const GOLD = rgb(0.67, 0.51, 0.28);
const MUTED = rgb(0.39, 0.44, 0.49);
const PAPER = rgb(0.99, 0.98, 0.95);

@Injectable()
export class CertificatePdfService {
  async generate(certificate: Certificate): Promise<Buffer> {
    const doc = await PDFDocument.create();
    doc.setTitle('Certificate of Completion');
    doc.setAuthor('Online Study Platform');
    doc.setCreationDate(certificate.issuedAt);
    const [regular, bold, heading] = await Promise.all([
      doc.embedFont(StandardFonts.Helvetica),
      doc.embedFont(StandardFonts.HelveticaBold),
      doc.embedFont(StandardFonts.TimesRomanBold),
    ]);
    const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    page.drawRectangle({
      x: 0,
      y: 0,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT,
      color: PAPER,
    });
    page.drawRectangle({
      x: 24,
      y: 24,
      width: 794,
      height: 547,
      borderColor: NAVY,
      borderWidth: 1,
    });
    page.drawRectangle({
      x: 32,
      y: 32,
      width: 778,
      height: 531,
      borderColor: GOLD,
      borderWidth: 0.5,
    });

    this.drawCornerDetails(page);
    const centered = (
      text: string,
      y: number,
      size: number,
      font: PDFFont = regular,
      color: RGB = NAVY,
    ) => this.drawCentered(page, font, text, size, y, color);

    for (const [start, end] of [
      [104, 275],
      [567, 738],
    ]) {
      page.drawLine({
        start: { x: start, y: 533 },
        end: { x: end, y: 533 },
        color: GOLD,
        thickness: 0.6,
      });
    }
    centered('ONLINE STUDY PLATFORM', 529, 11, bold);
    centered('ONLINE LEARNING & ACHIEVEMENT', 509, 8, regular, MUTED);
    centered('CERTIFICATE OF COMPLETION', 451, 32, heading);
    centered('AWARDED FOR SUCCESSFUL COURSE COMPLETION', 427, 9, regular, GOLD);
    page.drawLine({
      start: { x: 392, y: 407 },
      end: { x: 450, y: 407 },
      color: GOLD,
      thickness: 1.5,
    });
    centered('This certifies that', 380, 10, regular, MUTED);
    this.drawTextBlock(page, bold, certificate.learnerName, 339, 34, 2, 67);
    centered('has successfully completed the course', 287, 11);
    centered(
      'and passed all required learning activities.',
      269,
      9,
      regular,
      MUTED,
    );
    this.drawTextBlock(page, bold, certificate.courseTitle, 224, 22, 3, 78);

    page.drawLine({
      start: { x: 92, y: 156 },
      end: { x: 750, y: 156 },
      color: GOLD,
      thickness: 0.6,
    });
    const date = certificate.issuedAt.toLocaleDateString('en-GB', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
    page.drawText('ISSUED ON', {
      x: 92,
      y: 129,
      size: 8,
      font: regular,
      color: MUTED,
    });
    page.drawText(date, { x: 92, y: 109, size: 12, font: bold, color: NAVY });
    page.drawText('CERTIFICATE ID', {
      x: 541,
      y: 129,
      size: 8,
      font: regular,
      color: MUTED,
    });
    page.drawText(certificate.id, {
      x: 541,
      y: 109,
      size: 8,
      font: regular,
      color: NAVY,
    });
    this.drawCompletionEmblem(page);
    centered('COMPLETED', 69, 7, bold, GOLD);
    centered('Issued by Online Study Platform', 48, 7, regular, MUTED);
    return Buffer.from(await doc.save());
  }

  private drawCentered(
    page: PDFPage,
    font: PDFFont,
    text: string,
    size: number,
    y: number,
    color: RGB = NAVY,
  ): void {
    page.drawText(text, {
      x: (PAGE_WIDTH - font.widthOfTextAtSize(text, size)) / 2,
      y,
      size,
      font,
      color,
    });
  }

  private drawTextBlock(
    page: PDFPage,
    font: PDFFont,
    text: string,
    centerY: number,
    preferredSize: number,
    maxLines: number,
    maxHeight: number,
  ): void {
    // Only the PDF display is transliterated; the certificate snapshot stays intact.
    const clean = text
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/đ/gu, 'd')
      .replace(/Đ/gu, 'D')
      .replace(/\s+/gu, ' ')
      .trim();
    let size = preferredSize;
    let lines = this.wrapText(clean, font, size);
    while (
      lines.length > maxLines ||
      font.heightAtSize(size) + (lines.length - 1) * size * 1.2 > maxHeight
    ) {
      size *= 0.95;
      lines = this.wrapText(clean, font, size);
    }
    this.balanceLines(lines, font, size);
    const lineHeight = size * 1.2;
    const baselineOffset =
      font.heightAtSize(size, { descender: false }) -
      font.heightAtSize(size) / 2;
    const firstBaseline =
      centerY + ((lines.length - 1) * lineHeight) / 2 - baselineOffset;
    lines.forEach((line, index) =>
      this.drawCentered(
        page,
        font,
        line,
        size,
        firstBaseline - index * lineHeight,
      ),
    );
  }

  private wrapText(text: string, font: PDFFont, size: number): string[] {
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(' ')) {
      // Split unusually long unbroken words as well as ordinary word boundaries.
      const parts: string[] = [];
      let part = '';
      for (const character of Array.from(word)) {
        if (
          part &&
          font.widthOfTextAtSize(part + character, size) > CONTENT_WIDTH
        ) {
          parts.push(part);
          part = '';
        }
        part += character;
      }
      parts.push(part);
      for (const segment of parts) {
        const candidate = line ? `${line} ${segment}` : segment;
        if (line && font.widthOfTextAtSize(candidate, size) > CONTENT_WIDTH) {
          lines.push(line);
          line = segment;
        } else {
          line = candidate;
        }
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  private balanceLines(lines: string[], font: PDFFont, size: number): void {
    // Balance adjacent centered lines so a long title does not end with one word.
    const width = (text: string) => font.widthOfTextAtSize(text, size);
    for (let pass = 0; pass < lines.length; pass++) {
      for (let index = lines.length - 1; index > 0; index--) {
        const words = lines[index - 1].split(' ');
        while (words.length > 1) {
          const previous = words.slice(0, -1).join(' ');
          const next = `${words[words.length - 1]} ${lines[index]}`;
          if (
            width(next) > CONTENT_WIDTH ||
            Math.abs(width(previous) - width(next)) >=
              Math.abs(width(lines[index - 1]) - width(lines[index]))
          ) {
            break;
          }
          lines[index - 1] = previous;
          lines[index] = next;
          words.pop();
        }
      }
    }
  }

  private drawCornerDetails(page: PDFPage): void {
    for (const [x, y, directionX, directionY] of [
      [48, 547, 1, -1],
      [794, 547, -1, -1],
      [48, 48, 1, 1],
      [794, 48, -1, 1],
    ]) {
      for (const inset of [0, 5]) {
        const corner = { x: x + inset * directionX, y: y + inset * directionY };
        page.drawLine({
          start: corner,
          end: { x: corner.x + 27 * directionX, y: corner.y },
          color: GOLD,
          thickness: 0.6,
        });
        page.drawLine({
          start: corner,
          end: { x: corner.x, y: corner.y + 27 * directionY },
          color: GOLD,
          thickness: 0.6,
        });
      }
    }
  }

  private drawCompletionEmblem(page: PDFPage): void {
    for (const radius of [25, 21]) {
      page.drawCircle({
        x: PAGE_WIDTH / 2,
        y: 111,
        size: radius,
        borderColor: GOLD,
        borderWidth: radius === 25 ? 1 : 0.4,
      });
    }
    page.drawLine({
      start: { x: 410, y: 112 },
      end: { x: 418, y: 104 },
      color: NAVY,
      thickness: 2,
    });
    page.drawLine({
      start: { x: 418, y: 104 },
      end: { x: 433, y: 120 },
      color: NAVY,
      thickness: 2,
    });
  }
}
