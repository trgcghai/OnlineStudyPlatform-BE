import type { ConsumeMessage } from 'amqplib';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  NOTIFICATION_CREATE_DLQ,
  NOTIFICATION_CREATE_RETRY_QUEUE,
  NOTIFICATION_CREATE_ROUTING_KEY,
  NOTIFICATION_EXCHANGE,
  NOTIFICATION_MAX_RETRIES,
  NOTIFICATION_RETRY_HEADER,
} from './notification-queue.constants';
import { NotificationQueue } from './entities/notification.entity';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsQueueService } from './notifications-queue.service';
import { NotificationsService } from './notifications.service';

describe('NotificationsQueueService', () => {
  let service: NotificationsQueueService;
  let channel: {
    publish: jest.Mock;
    ack: jest.Mock;
  };
  let notificationsService: { createFromQueueMessage: jest.Mock };
  let notificationsGateway: {
    emitNotificationCreatedToUser: jest.Mock;
    emitNotificationCreatedForQueue: jest.Mock;
  };

  const message = {
    kind: 'direct' as const,
    targetUserId: 'user-1',
    title: 'Payment success',
    message: 'Your payment succeeded',
    triggerKey: 'payment-success:tx-1',
    triggerDate: '2026-09-24',
  };

  beforeEach(() => {
    channel = {
      publish: jest.fn().mockReturnValue(true),
      ack: jest.fn(),
    };
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
    service = new NotificationsQueueService(
      { getOrThrow: jest.fn() } as unknown as ConfigService,
      notificationsService as unknown as NotificationsService,
      notificationsGateway as unknown as NotificationsGateway,
    );
    Object.assign(service, { channel });
  });

  it('publishes create notification messages as persistent JSON', () => {
    service.enqueueCreateNotification(message);

    expect(channel.publish).toHaveBeenCalledWith(
      NOTIFICATION_EXCHANGE,
      NOTIFICATION_CREATE_ROUTING_KEY,
      Buffer.from(JSON.stringify(message)),
      expect.objectContaining({
        persistent: true,
        contentType: 'application/json',
      }),
    );
  });

  it('handles a valid create message and acknowledges it', async () => {
    const rawMessage = createRawMessage(message);

    await service.handleCreateMessage(rawMessage);

    expect(notificationsService.createFromQueueMessage).toHaveBeenCalledWith(
      message,
    );
    expect(channel.ack).toHaveBeenCalledWith(rawMessage);
  });

  it('emits a direct realtime signal after successful persistence', async () => {
    const rawMessage = createRawMessage(message);

    await service.handleCreateMessage(rawMessage);

    expect(
      notificationsGateway.emitNotificationCreatedToUser,
    ).toHaveBeenCalledWith('user-1', 'notification-1');
    expect(channel.ack).toHaveBeenCalledWith(rawMessage);
  });

  it('emits a queue realtime signal after successful queue notification persistence', async () => {
    const queueMessage = {
      kind: 'queue' as const,
      queue: NotificationQueue.COURSE_APPROVAL,
      title: 'Yêu cầu duyệt khóa học',
      message: 'Một khóa học cần được duyệt.',
      triggerKey: 'course-publication-request:course-1',
      triggerDate: '2026-09-24',
    };
    const rawMessage = createRawMessage(queueMessage);

    await service.handleCreateMessage(rawMessage);

    expect(
      notificationsGateway.emitNotificationCreatedForQueue,
    ).toHaveBeenCalledWith(NotificationQueue.COURSE_APPROVAL, 'notification-1');
    expect(channel.ack).toHaveBeenCalledWith(rawMessage);
  });

  it('does not emit when notification creation is a duplicate no-op', async () => {
    notificationsService.createFromQueueMessage.mockResolvedValueOnce({
      created: false,
      duplicate: true,
    });
    const rawMessage = createRawMessage(message);

    await service.handleCreateMessage(rawMessage);

    expect(
      notificationsGateway.emitNotificationCreatedToUser,
    ).not.toHaveBeenCalled();
    expect(
      notificationsGateway.emitNotificationCreatedForQueue,
    ).not.toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledWith(rawMessage);
  });

  it('routes malformed messages to the DLQ and acknowledges them', async () => {
    const rawMessage = createRawMessage({ kind: 'direct' });

    await service.handleCreateMessage(rawMessage);

    expect(channel.publish).toHaveBeenCalledWith(
      NOTIFICATION_EXCHANGE,
      NOTIFICATION_CREATE_DLQ,
      rawMessage.content,
      expect.objectContaining({ persistent: true }),
    );
    expect(
      notificationsGateway.emitNotificationCreatedToUser,
    ).not.toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledWith(rawMessage);
  });

  it('routes transient failures to the retry queue and acknowledges them', async () => {
    notificationsService.createFromQueueMessage.mockRejectedValueOnce(
      new Error('mongo timeout'),
    );
    const rawMessage = createRawMessage(message);

    await service.handleCreateMessage(rawMessage);

    expect(channel.publish).toHaveBeenCalledWith(
      NOTIFICATION_EXCHANGE,
      NOTIFICATION_CREATE_RETRY_QUEUE,
      rawMessage.content,
      expect.objectContaining({
        headers: expect.objectContaining({ [NOTIFICATION_RETRY_HEADER]: 1 }),
      }),
    );
    expect(
      notificationsGateway.emitNotificationCreatedToUser,
    ).not.toHaveBeenCalled();
    expect(
      notificationsGateway.emitNotificationCreatedForQueue,
    ).not.toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledWith(rawMessage);
  });

  it('does not emit malformed messages and routes them to the DLQ', async () => {
    const rawMessage = createRawMessage({ kind: 'direct' });

    await service.handleCreateMessage(rawMessage);

    expect(
      notificationsGateway.emitNotificationCreatedToUser,
    ).not.toHaveBeenCalled();
    expect(
      notificationsGateway.emitNotificationCreatedForQueue,
    ).not.toHaveBeenCalled();
    expect(channel.publish).toHaveBeenCalledWith(
      NOTIFICATION_EXCHANGE,
      NOTIFICATION_CREATE_DLQ,
      rawMessage.content,
      expect.objectContaining({ persistent: true }),
    );
    expect(channel.ack).toHaveBeenCalledWith(rawMessage);
  });

  it('acks persisted messages when best-effort realtime emission fails', async () => {
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    notificationsGateway.emitNotificationCreatedToUser.mockImplementationOnce(
      () => {
        throw new Error('socket server unavailable');
      },
    );
    const rawMessage = createRawMessage(message);

    await service.handleCreateMessage(rawMessage);

    expect(channel.publish).not.toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledWith(rawMessage);
    expect(errorSpy).toHaveBeenCalledWith(
      'Could not emit notification created event',
      expect.stringContaining('socket server unavailable'),
    );

    errorSpy.mockRestore();
  });

  it('routes exhausted retries to the DLQ and acknowledges them', async () => {
    notificationsService.createFromQueueMessage.mockRejectedValueOnce(
      new Error('mongo timeout'),
    );
    const rawMessage = createRawMessage(message, {
      [NOTIFICATION_RETRY_HEADER]: NOTIFICATION_MAX_RETRIES,
    });

    await service.handleCreateMessage(rawMessage);

    expect(channel.publish).toHaveBeenCalledWith(
      NOTIFICATION_EXCHANGE,
      NOTIFICATION_CREATE_DLQ,
      rawMessage.content,
      expect.objectContaining({ persistent: true }),
    );
    expect(channel.ack).toHaveBeenCalledWith(rawMessage);
  });

  it('validates queue notification targets', async () => {
    const rawMessage = createRawMessage({
      kind: 'queue',
      queue: NotificationQueue.COURSE_APPROVAL,
      title: 'Yêu cầu duyệt khóa học',
      message: 'Một khóa học cần được duyệt.',
      triggerKey: 'course-publication-request:course-1',
      triggerDate: '2026-09-24',
    });

    await service.handleCreateMessage(rawMessage);

    expect(notificationsService.createFromQueueMessage).toHaveBeenCalledWith({
      kind: 'queue',
      queue: NotificationQueue.COURSE_APPROVAL,
      title: 'Yêu cầu duyệt khóa học',
      message: 'Một khóa học cần được duyệt.',
      triggerKey: 'course-publication-request:course-1',
      triggerDate: '2026-09-24',
    });
  });

  function createRawMessage(
    payload: unknown,
    headers: Record<string, unknown> = {},
  ): ConsumeMessage {
    return {
      content: Buffer.from(JSON.stringify(payload)),
      properties: {
        headers,
        contentType: 'application/json',
      },
    } as ConsumeMessage;
  }
});
