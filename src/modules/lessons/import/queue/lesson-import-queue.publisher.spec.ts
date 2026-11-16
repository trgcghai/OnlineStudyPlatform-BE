import {
  LESSON_IMPORT_JOB,
  LESSON_IMPORT_QUEUE_OPTIONS,
} from './lesson-import-queue.constants';
import { LessonImportQueuePublisher } from './lesson-import-queue.publisher';

describe('LessonImportQueuePublisher', () => {
  it('enqueues lesson import jobs with BullMQ options', async () => {
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const publisher = new LessonImportQueuePublisher(queue as never);
    const message = { importId: 'import-1' };

    await publisher.enqueue(message);

    expect(queue.add).toHaveBeenCalledWith(
      LESSON_IMPORT_JOB,
      message,
      LESSON_IMPORT_QUEUE_OPTIONS,
    );
  });

  it('converts queue errors to service-unavailable errors', async () => {
    const queue = { add: jest.fn().mockRejectedValue(new Error('redis down')) };
    const publisher = new LessonImportQueuePublisher(queue as never);

    await expect(publisher.enqueue({ importId: 'import-1' })).rejects.toThrow(
      'Import queue is unavailable',
    );
  });
});
