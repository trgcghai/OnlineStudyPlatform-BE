import { NotFoundException } from '@nestjs/common';
import { Readable } from 'node:stream';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Certificate } from './entities/certificate.entity';
import { CertificatePdfService } from './certificate-pdf.service';
import { CertificateStorageService } from './certificate-storage.service';
import { CertificatesService } from './certificates.service';

describe('CertificatesService', () => {
  const repository = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn((value: unknown) => value),
    save: jest.fn((value: unknown) => value),
  };
  const advisoryLock = jest.fn();
  const manager = {
    query: advisoryLock,
    getRepository: () => repository,
  } as unknown as EntityManager;
  const source = {
    transaction: jest.fn((callback: (value: EntityManager) => unknown) =>
      callback(manager),
    ),
  };
  const eligibility = { getEligibleEnrollment: jest.fn() };
  const pdf = { generate: jest.fn() };
  const storage = { upload: jest.fn(), download: jest.fn(), remove: jest.fn() };
  const service = new CertificatesService(
    repository as unknown as Repository<Certificate>,
    source as unknown as DataSource,
    eligibility,
    pdf as unknown as CertificatePdfService,
    storage as unknown as CertificateStorageService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    repository.findOne.mockResolvedValue(null);
    repository.save.mockImplementation((value) => Promise.resolve(value));
    eligibility.getEligibleEnrollment.mockResolvedValue({
      learner: { name: 'Nguyễn Thị Ánh' },
      course: { title: 'Lập trình cơ bản' },
    });
    pdf.generate.mockResolvedValue(Buffer.from('%PDF-1.7'));
    storage.upload.mockResolvedValue(undefined);
    storage.remove.mockResolvedValue(undefined);
  });

  it('issues only after PDF upload, freezing the names and stable URL', async () => {
    const certificate = await service.issue('learner', 'course');
    expect(certificate).toMatchObject({
      learnerId: 'learner',
      courseId: 'course',
      learnerName: 'Nguyễn Thị Ánh',
      courseTitle: 'Lập trình cơ bản',
      issuedAt: expect.any(Date),
    });
    expect(certificate?.certificateUrl).toBe(
      `/learner/certificates/${certificate?.id}/download`,
    );
    expect(storage.upload.mock.invocationCallOrder[0]).toBeLessThan(
      repository.save.mock.invocationCallOrder[0],
    );
    expect(advisoryLock).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
      ['learner', 'course'],
    );
  });

  it('returns the immutable existing certificate on repeated checks', async () => {
    const original = {
      id: 'original',
      issuedAt: new Date('2026-09-01'),
      learnerName: 'Tên cũ',
    };
    repository.findOne.mockResolvedValue(original);
    expect(await service.issue('learner', 'course')).toBe(original);
    expect(eligibility.getEligibleEnrollment).not.toHaveBeenCalled();
    expect(storage.upload).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('does not issue when the worker detects incomplete activities', async () => {
    eligibility.getEligibleEnrollment.mockResolvedValue(null);
    expect(await service.issue('learner', 'course')).toBeNull();
    expect(pdf.generate).not.toHaveBeenCalled();
  });

  it('propagates upload errors for BullMQ retry and never inserts a broken URL', async () => {
    storage.upload.mockRejectedValueOnce(new Error('MinIO unavailable'));
    await expect(service.issue('learner', 'course')).rejects.toThrow(
      'MinIO unavailable',
    );
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('cleans the PDF when the transaction fails after upload', async () => {
    repository.save.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(service.issue('learner', 'course')).rejects.toThrow(
      'database unavailable',
    );
    expect(storage.remove).toHaveBeenCalledWith(
      expect.stringMatching(/^certificates\/.*\.pdf$/),
    );
  });

  it('preserves the PDF when the COMMIT response is lost', async () => {
    source.transaction.mockImplementationOnce(async (callback) => {
      await callback(manager);
      throw new Error('lost commit response');
    });
    await expect(service.issue('learner', 'course')).rejects.toThrow(
      'lost commit response',
    );
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it('preserves the original failure even when PDF cleanup fails', async () => {
    repository.save.mockRejectedValueOnce(new Error('original failure'));
    storage.remove.mockRejectedValueOnce(new Error('cleanup failure'));
    await expect(service.issue('learner', 'course')).rejects.toThrow(
      'original failure',
    );
  });

  it('lists only the owner and omits the internal object key', async () => {
    repository.find.mockResolvedValue([
      {
        id: 'id',
        objectKey: 'secret',
        learnerId: 'learner',
        courseId: 'course',
        certificateUrl: '/download',
      },
    ]);
    const list = await service.list('learner');
    expect(repository.find).toHaveBeenCalledWith({
      where: { learnerId: 'learner' },
      order: { issuedAt: 'DESC', id: 'ASC' },
    });
    expect(list[0]).not.toHaveProperty('objectKey');
    expect(list[0]).not.toHaveProperty('learnerId');
  });

  it('streams an owned PDF with its attachment headers', async () => {
    repository.findOne.mockResolvedValue({
      id: 'id',
      objectKey: 'certificates/id.pdf',
    });
    storage.download.mockResolvedValue(Readable.from(Buffer.from('%PDF-1.7')));
    const file = await service.download('learner', 'id');
    expect(repository.findOne).toHaveBeenCalledWith({
      where: { id: 'id', learnerId: 'learner' },
    });
    expect(file.getHeaders()).toMatchObject({
      type: 'application/pdf',
      disposition: 'attachment; filename="certificate-id.pdf"',
    });
  });

  it('hides missing or another learner’s certificate without reading storage', async () => {
    await expect(service.download('other', 'id')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(storage.download).not.toHaveBeenCalled();
  });

  it('verifies only the public snapshot fields', async () => {
    repository.findOne.mockResolvedValue({
      id: 'id',
      learnerName: 'Ánh',
      courseTitle: 'Khóa học',
      issuedAt: new Date(),
      objectKey: 'secret',
      learnerId: 'private',
    });
    expect(await service.verify('id')).toEqual({
      valid: true,
      id: 'id',
      learnerName: 'Ánh',
      courseTitle: 'Khóa học',
      issuedAt: expect.any(Date),
    });
  });

  it('rejects verification of a nonexistent certificate', async () => {
    await expect(service.verify('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
