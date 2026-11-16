import { NotificationQueue } from './entities/notification.entity';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsQueueProcessor } from './notifications-queue.processor';
import { NotificationsService } from './notifications.service';

describe('NotificationsQueueProcessor', () => {
  let processor: NotificationsQueueProcessor;
  let notificationsService: { createFromQueueMessage: jest.Mock };
  let notificationsGateway: {
    emitNotificationCreatedToUser: jest.Mock;
    emitNotificationCreatedForQueue: jest.Mock;
  };

  const directMessage = {
    kind: 'direct' as const,
    targetUserId: 'user-1',
    title: 'Payment success',
    message: 'Your payment succeeded',
    triggerKey: 'payment-success:tx-1',
    triggerDate: '2026-09-24',
  };

  beforeEach(() => {
    notificationsService = {
      createFromQueueMessage: jest.fn().mockResolvedValue({
        created: true,
        duplicate: false,
        notificationId: 'notification-1',
      }),
    };
    notificationsGateway = {
      emitNotificationCreatedToUser: jest.fn(),
      emitNotificationCreatedForQueue: jest.fn(),
    };
    processor = new NotificationsQueueProcessor(
      notificationsService as unknown as NotificationsService,
      notificationsGateway as unknown as NotificationsGateway,
    );
  });

  it('creates and emits a direct notification', async () => {
    await processor.process({ id: 'job-1', data: directMessage } as never);

    expect(notificationsService.createFromQueueMessage).toHaveBeenCalledWith(
      directMessage,
    );
    expect(
      notificationsGateway.emitNotificationCreatedToUser,
    ).toHaveBeenCalledWith('user-1', 'notification-1');
  });

  it('emits queue notifications to the queue room', async () => {
    const message = {
      kind: 'queue' as const,
      queue: NotificationQueue.COURSE_APPROVAL,
      title: 'Course approval',
      message: 'A course needs review',
      triggerKey: 'course-approval:course-1',
      triggerDate: '2026-09-24',
    };

    await processor.process({ id: 'job-1', data: message } as never);

    expect(
      notificationsGateway.emitNotificationCreatedForQueue,
    ).toHaveBeenCalledWith(NotificationQueue.COURSE_APPROVAL, 'notification-1');
  });

  it('does not emit duplicate notifications', async () => {
    notificationsService.createFromQueueMessage.mockResolvedValueOnce({
      created: false,
      duplicate: true,
    });

    await processor.process({ id: 'job-1', data: directMessage } as never);

    expect(
      notificationsGateway.emitNotificationCreatedToUser,
    ).not.toHaveBeenCalled();
    expect(
      notificationsGateway.emitNotificationCreatedForQueue,
    ).not.toHaveBeenCalled();
  });

  it('rejects invalid notification payloads', async () => {
    await expect(
      processor.process({
        id: 'job-1',
        data: { kind: 'direct' },
      } as never),
    ).rejects.toThrow('Invalid notification message');
    expect(notificationsService.createFromQueueMessage).not.toHaveBeenCalled();
  });

  it('does not fail the job when realtime emission is unavailable', async () => {
    notificationsGateway.emitNotificationCreatedToUser.mockImplementationOnce(
      () => {
        throw new Error('socket server unavailable');
      },
    );

    await expect(
      processor.process({ id: 'job-1', data: directMessage } as never),
    ).resolves.toBeUndefined();
  });
});
