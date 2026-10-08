import { PDFDocument, PDFPage } from 'pdf-lib';
import { CertificatePdfService } from './certificate-pdf.service';
import { Certificate } from './entities/certificate.entity';

describe('Certificate PDF', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    {
      label: 'Vietnamese names',
      learnerName: 'Nguyễn Hoàng Minh Anh',
      courseTitle: 'Lập trình Java từ cơ bản đến nâng cao',
      expectedLearnerName: 'Nguyen Hoang Minh Anh',
      expectedCourseTitle: 'Lap trinh Java tu co ban den nang cao',
    },
    {
      label: 'long names and course titles',
      learnerName:
        'Nguyễn Thị Hoàng Ánh Hồng Phương Thảo Minh Châu Thanh Trúc Bảo Ngọc',
      courseTitle:
        'Phát triển ứng dụng web toàn diện với React, Next.js, NestJS và PostgreSQL: từ phân tích yêu cầu đến triển khai hệ thống học trực tuyến',
      expectedLearnerName:
        'Nguyen Thi Hoang Anh Hong Phuong Thao Minh Chau Thanh Truc Bao Ngoc',
      expectedCourseTitle:
        'Phat trien ung dung web toan dien voi React, Next.js, NestJS va PostgreSQL: tu phan tich yeu cau den trien khai he thong hoc truc tuyen',
    },
    {
      label: 'decomposed accents and unbroken titles',
      learnerName: 'Nguyễn Thị Ánh\nHồng'.normalize('NFD'),
      courseTitle: 'Khóa học lập trình tiếng Việt'.repeat(5).replace(/ /gu, ''),
      expectedLearnerName: 'Nguyen Thi Anh Hong',
      expectedCourseTitle: 'KhoahoclaptrinhtiengViet'.repeat(5),
    },
    {
      label: 'Vietnamese D variants and English punctuation',
      learnerName: 'Đỗ Đặng Đức Duy',
      courseTitle: 'Định hướng nghề nghiệp – Next.js & Node.js',
      expectedLearnerName: 'Do Dang Duc Duy',
      expectedCourseTitle: 'Dinh huong nghe nghiep – Next.js & Node.js',
    },
  ])(
    'renders $label without accents using standard fonts and English labels',
    async ({
      learnerName,
      courseTitle,
      expectedLearnerName,
      expectedCourseTitle,
    }) => {
      const drawText = jest.spyOn(PDFPage.prototype, 'drawText');
      const service = new CertificatePdfService();
      const certificate = Object.freeze({
        id: '11111111-1111-4111-8111-111111111111',
        learnerName,
        courseTitle,
        issuedAt: new Date('2026-10-05T18:30:00Z'),
      }) as Certificate;
      const bytes = await service.generate(certificate);
      expect(bytes.subarray(0, 4).toString()).toBe('%PDF');
      const doc = await PDFDocument.load(bytes);
      expect(doc.getTitle()).toBe('Certificate of Completion');
      expect(doc.getPages()).toHaveLength(1);
      expect(doc.getPages()[0].getSize()).toEqual({ width: 842, height: 595 });
      expect(doc.getPages()[0].node.Annots()?.size() ?? 0).toBe(0);

      const text = drawText.mock.calls.map(([value]) => value).join(' ');
      const compact = (value: string) =>
        value.normalize('NFC').replace(/\s/gu, '');
      expect(compact(text)).toContain(compact(expectedLearnerName));
      expect(compact(text)).toContain(compact(expectedCourseTitle));
      expect(text).toContain('06 October 2026');
      expect(text).toContain('CERTIFICATE OF COMPLETION');
      expect(text).toContain('ISSUED ON');
      expect(text).toContain('CERTIFICATE ID');
      expect(text).toContain('COMPLETED');
      expect(text).not.toMatch(/Chứng|Ngày|Học|Hoàn|\p{M}/u);
      expect(certificate.learnerName).toBe(learnerName);
      expect(certificate.courseTitle).toBe(courseTitle);
      expect(text).toContain('11111111-1111-4111-8111-111111111111');
      expect(text).not.toMatch(/verify|xác minh|https?:\/\//iu);

      for (const [value, options] of drawText.mock.calls) {
        if (
          !options?.font ||
          !options.size ||
          options.x === undefined ||
          options.y === undefined
        ) {
          throw new Error('All certificate text must have explicit layout');
        }
        expect(options.font.getCharacterSet()).toEqual(
          expect.arrayContaining(
            Array.from(value, (character) => character.codePointAt(0)),
          ),
        );
        expect(options.x).toBeGreaterThanOrEqual(62);
        expect(
          options.x + options.font.widthOfTextAtSize(value, options.size),
        ).toBeLessThanOrEqual(780);
        expect(options.y).toBeGreaterThan(32);
        expect(
          options.y +
            options.font.heightAtSize(options.size, { descender: false }),
        ).toBeLessThan(563);
      }
    },
  );
});
