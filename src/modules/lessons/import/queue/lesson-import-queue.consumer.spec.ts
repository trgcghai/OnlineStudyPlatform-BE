import { LessonImportProcessorService } from '../lesson-import-processor.service';
import { LessonImportQueueConsumer } from './lesson-import-queue.consumer';

describe('LessonImportQueueConsumer', () => {
  let processorService: {
    process: jest.Mock;
    failPermanently: jest.Mock;
  };
  let consumer: LessonImportQueueConsumer;

  beforeEach(() => {
    processorService = {
      process: jest.fn().mockResolvedValue(undefined),
      failPermanently: jest.fn().mockResolvedValue(undefined),
    };
    consumer = new LessonImportQueueConsumer(
      processorService as unknown as LessonImportProcessorService,
    );
  });

  it('processes a valid lesson import job', async () => {
    await consumer.process({
      id: 'job-1',
      attemptsMade: 0,
      opts: { attempts: 4 },
      data: { importId: 'import-1' },
    } as never);

    expect(processorService.process).toHaveBeenCalledWith('import-1');
    expect(processorService.failPermanently).not.toHaveBeenCalled();
  });

  it('retries processing failures before the final attempt', async () => {
    const error = new Error('archive processing failed');
    processorService.process.mockRejectedValueOnce(error);

    await expect(
      consumer.process({
        id: 'job-1',
        attemptsMade: 0,
        opts: { attempts: 4 },
        data: { importId: 'import-1' },
      } as never),
    ).rejects.toBe(error);
    expect(processorService.failPermanently).not.toHaveBeenCalled();
  });

  it('marks the import failed on the final attempt', async () => {
    const error = new Error('archive processing failed');
    processorService.process.mockRejectedValueOnce(error);

    await expect(
      consumer.process({
        id: 'job-1',
        attemptsMade: 3,
        opts: { attempts: 4 },
        data: { importId: 'import-1' },
      } as never),
    ).rejects.toBe(error);
    expect(processorService.failPermanently).toHaveBeenCalledWith('import-1');
  });

  it('rejects malformed jobs', async () => {
    await expect(
      consumer.process({
        id: 'job-1',
        attemptsMade: 0,
        opts: { attempts: 4 },
        data: { importId: '' },
      } as never),
    ).rejects.toThrow('Invalid lesson import message');
    expect(processorService.process).not.toHaveBeenCalled();
  });
});
