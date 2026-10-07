import { Job, Queue } from 'bullmq';
import { CERTIFICATE_JOB, CertificateJobData } from './certificate.constants';
import { CertificateQueueService } from './certificate-queue.service';
import { CertificateProcessor } from './certificate-processor';
import { CertificatesService } from './certificates.service';
import { CertificateReconciliationService } from './certificate-reconciliation.service';
import { Repository } from 'typeorm';
import { Enrollment } from '../enrollments/entities/enrollment.entity';

describe('Certificate jobs', () => {
  it('uses a stable job ID with bounded retries and exponential backoff', async () => {
    const queue = { add: jest.fn().mockResolvedValue({}) };
    const publisher = new CertificateQueueService(
      queue as unknown as Queue<CertificateJobData>,
    );
    await publisher.enqueue('learner', 'course');
    expect(queue.add).toHaveBeenCalledWith(
      CERTIFICATE_JOB,
      { learnerId: 'learner', courseId: 'course' },
      {
        jobId: 'certificate-learner-course',
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  });

  it('preserves learning completion when Redis is unavailable', async () => {
    const publisher = new CertificateQueueService({
      add: jest.fn().mockRejectedValue(new Error('Redis down')),
    } as unknown as Queue<CertificateJobData>);
    await expect(
      publisher.enqueueCompletion('learner', 'course'),
    ).resolves.toBeUndefined();
  });

  it('sends completion to the queue', async () => {
    const queue = { add: jest.fn().mockResolvedValue({}) };
    await new CertificateQueueService(
      queue as unknown as Queue<CertificateJobData>,
    ).enqueueCompletion('learner', 'course');
    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('propagates worker failures to BullMQ and rejects unknown jobs', async () => {
    const certificates = {
      issue: jest
        .fn()
        .mockRejectedValueOnce(new Error('temporary error'))
        .mockResolvedValue(null),
    };
    const worker = new CertificateProcessor(
      certificates as unknown as CertificatesService,
    );
    const job = {
      name: CERTIFICATE_JOB,
      data: { learnerId: 'learner', courseId: 'course' },
    } as Job<CertificateJobData>;
    await expect(worker.process(job)).rejects.toThrow('temporary error');
    await expect(worker.process(job)).resolves.toBeUndefined();
    await expect(
      worker.process({ ...job, name: 'unknown' } as Job<CertificateJobData>),
    ).rejects.toThrow('Unknown certificate job');
  });
});

describe('Certificate reconciliation', () => {
  const query = {
    leftJoin: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn(),
  };
  const repository = {
    createQueryBuilder: () => query,
  } as unknown as Repository<Enrollment>;
  const queue = { enqueue: jest.fn() };
  let reconciler: CertificateReconciliationService;

  beforeEach(() => {
    jest.clearAllMocks();
    reconciler = new CertificateReconciliationService(
      repository,
      queue as unknown as CertificateQueueService,
    );
    queue.enqueue.mockResolvedValue(undefined);
  });

  it('backfills only completed enrollments with no certificate', async () => {
    query.getMany.mockResolvedValue([
      { learnerId: 'learner', courseId: 'course' },
    ]);
    await reconciler.reconcile();
    expect(query.andWhere).toHaveBeenCalledWith('certificate.id IS NULL');
    expect(queue.enqueue).toHaveBeenCalledWith('learner', 'course');
  });

  it('advances the cursor to avoid starvation and resets after the last page', async () => {
    const rows = Array.from({ length: 100 }, (_, index) => ({
      id: String(index),
      learnerId: 'learner',
      courseId: String(index),
    }));
    query.getMany
      .mockResolvedValueOnce(rows)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    await reconciler.reconcile();
    await reconciler.reconcile();
    expect(query.andWhere).toHaveBeenCalledWith('enrollment.id > :cursor', {
      cursor: '99',
    });
    query.andWhere.mockClear();
    await reconciler.reconcile();
    expect(query.andWhere).not.toHaveBeenCalledWith(
      'enrollment.id > :cursor',
      expect.anything(),
    );
  });

  it('leaves failed batches available for the next run', async () => {
    query.getMany.mockResolvedValue([
      { learnerId: 'learner', courseId: 'course' },
    ]);
    queue.enqueue.mockRejectedValueOnce(new Error('Redis down'));
    await expect(reconciler.reconcile()).resolves.toBeUndefined();
    await reconciler.reconcile();
    expect(queue.enqueue).toHaveBeenCalledTimes(2);
  });
});
