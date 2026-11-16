import { NotificationsQueueService } from './notifications-queue.service';
import {
  NOTIFICATION_CREATE_JOB,
  NOTIFICATION_QUEUE_OPTIONS,
} from './notification-queue.constants';
import { NotificationCreateMessage } from './dto/notification.dto';

describe('NotificationsQueueService', () => {
  let service: NotificationsQueueService;
  let queue: { add: jest.Mock };

  const message: NotificationCreateMessage = {
    kind: 'direct',
    targetUserId: 'user-1',
    title: 'Payment success',
    message: 'Your payment succeeded',
    triggerKey: 'payment-success:tx-1',
    triggerDate: '2026-09-24',
  };

  beforeEach(() => {
    queue = { add: jest.fn().mockResolvedValue(undefined) };
    service = new NotificationsQueueService(queue as never);
  });

  it('enqueues notification creation with BullMQ retry options', () => {
    service.enqueueCreateNotification(message);

    expect(queue.add).toHaveBeenCalledWith(
      NOTIFICATION_CREATE_JOB,
      message,
      NOTIFICATION_QUEUE_OPTIONS,
    );
  });

  it('logs queue failures without throwing from fire-and-forget callers', async () => {
    const error = new Error('redis down');
    queue.add.mockRejectedValueOnce(error);
    const loggerSpy = jest
      .spyOn(
        (service as unknown as { logger: { error: jest.Mock } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);

    service.enqueueCreateNotification(message);
    await Promise.resolve();

    expect(loggerSpy).toHaveBeenCalledWith(
      'Could not enqueue notification creation job',
      error.stack,
    );
    loggerSpy.mockRestore();
  });
});
