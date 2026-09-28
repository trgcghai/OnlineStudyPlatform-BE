import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { UserRole } from '../users/entities/user.entity';
import {
  NotificationQueue,
  NotificationType,
} from './entities/notification.entity';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let notificationModel: jest.Mock;
  let save: jest.Mock;
  let findByIdAndDelete: jest.Mock;
  let find: jest.Mock;
  let countDocuments: jest.Mock;
  let findOneAndUpdate: jest.Mock;
  let exists: jest.Mock;
  let updateMany: jest.Mock;

  beforeEach(() => {
    save = jest.fn();
    findByIdAndDelete = jest.fn();
    find = jest.fn();
    countDocuments = jest.fn();
    findOneAndUpdate = jest.fn();
    exists = jest.fn();
    updateMany = jest.fn();
    notificationModel = jest.fn().mockImplementation((input: unknown) => ({
      ...input,
      _id: new Types.ObjectId('64b7f8f8f8f8f8f8f8f8f8f8'),
      save,
    }));
    notificationModel.findByIdAndDelete = findByIdAndDelete;
    notificationModel.find = find;
    notificationModel.countDocuments = countDocuments;
    notificationModel.findOneAndUpdate = findOneAndUpdate;
    notificationModel.exists = exists;
    notificationModel.updateMany = updateMany;

    service = new NotificationsService(notificationModel as unknown as never);
  });

  it('creates a queue notification with the course approval queue enum', async () => {
    const saved = {
      _id: new Types.ObjectId('64b7f8f8f8f8f8f8f8f8f8f8'),
      type: NotificationType.QUEUE,
      queue: NotificationQueue.COURSE_APPROVAL,
      title: 'Yêu cầu duyệt khóa học',
      message: 'Nguyen Van A đã gửi yêu cầu xuất bản khóa học "NestJS".',
      actionUrl: '/admin/courses/approvals',
      metadata: {
        courseId: '33333333-3333-4333-8333-333333333333',
        instructorId: '11111111-1111-4111-8111-111111111111',
      },
      sentAt: new Date('2026-08-24T00:00:00Z'),
      seen: false,
    };
    save.mockResolvedValue(saved);

    const result = await service.createQueueNotification({
      queue: NotificationQueue.COURSE_APPROVAL,
      title: 'Yêu cầu duyệt khóa học',
      message: 'Nguyen Van A đã gửi yêu cầu xuất bản khóa học "NestJS".',
      actionUrl: '/admin/courses/approvals',
      metadata: {
        courseId: '33333333-3333-4333-8333-333333333333',
        instructorId: '11111111-1111-4111-8111-111111111111',
      },
      sentAt: new Date('2026-08-24T00:00:00Z'),
    });

    expect(notificationModel).toHaveBeenCalledWith({
      type: NotificationType.QUEUE,
      queue: NotificationQueue.COURSE_APPROVAL,
      title: 'Yêu cầu duyệt khóa học',
      message: 'Nguyen Van A đã gửi yêu cầu xuất bản khóa học "NestJS".',
      actionUrl: '/admin/courses/approvals',
      metadata: {
        courseId: '33333333-3333-4333-8333-333333333333',
        instructorId: '11111111-1111-4111-8111-111111111111',
      },
      sentAt: new Date('2026-08-24T00:00:00Z'),
      seen: false,
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(result).toBe(saved);
  });

  it('creates a direct notification for a user UUID', async () => {
    const saved = {
      _id: new Types.ObjectId('64b7f8f8f8f8f8f8f8f8f8f8'),
      type: NotificationType.DIRECT,
      userId: '11111111-1111-4111-8111-111111111111',
      title: 'Khóa học đã được duyệt',
      message: 'Khóa học "NestJS" đã được xuất bản.',
      actionUrl: '/instructor/courses/course-id/edit',
      metadata: { courseId: 'course-id' },
      sentAt: new Date('2026-01-01T00:00:00Z'),
      seen: false,
    };
    save.mockResolvedValue(saved);

    const result = await service.createDirectNotification({
      userId: '11111111-1111-4111-8111-111111111111',
      title: 'Khóa học đã được duyệt',
      message: 'Khóa học "NestJS" đã được xuất bản.',
      actionUrl: '/instructor/courses/course-id/edit',
      metadata: { courseId: 'course-id' },
      sentAt: new Date('2026-01-01T00:00:00Z'),
    });

    expect(notificationModel).toHaveBeenCalledWith({
      type: NotificationType.DIRECT,
      userId: '11111111-1111-4111-8111-111111111111',
      title: 'Khóa học đã được duyệt',
      message: 'Khóa học "NestJS" đã được xuất bản.',
      actionUrl: '/instructor/courses/course-id/edit',
      metadata: { courseId: 'course-id' },
      sentAt: new Date('2026-01-01T00:00:00Z'),
      seen: false,
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(result).toBe(saved);
  });

  it('creates a direct notification from a queued message with dedupe fields', async () => {
    const saved = {
      _id: new Types.ObjectId('64b7f8f8f8f8f8f8f8f8f8f8'),
    };
    exists.mockResolvedValue(null);
    save.mockResolvedValue(saved);

    const result = await service.createFromQueueMessage({
      kind: 'direct',
      targetUserId: 'user-1',
      title: 'Payment success',
      message: 'Your payment succeeded',
      metadata: { transactionId: 'tx-1' },
      triggerKey: 'payment-success:tx-1',
      triggerDate: '2026-09-24',
    });

    expect(exists).toHaveBeenCalledWith({
      triggerKey: 'payment-success:tx-1',
      targetUserId: 'user-1',
      triggerDate: '2026-09-24',
    });
    expect(notificationModel).toHaveBeenCalledWith({
      type: NotificationType.DIRECT,
      userId: 'user-1',
      queue: undefined,
      title: 'Payment success',
      message: 'Your payment succeeded',
      actionUrl: undefined,
      metadata: { transactionId: 'tx-1' },
      sentAt: expect.any(Date),
      seen: false,
      triggerKey: 'payment-success:tx-1',
      triggerDate: '2026-09-24',
      targetUserId: 'user-1',
    });
    expect(result).toEqual({
      created: true,
      duplicate: false,
      notificationId: '64b7f8f8f8f8f8f8f8f8f8f8',
    });
  });

  it('uses a queue target user id when creating a queued queue notification', async () => {
    exists.mockResolvedValue(null);
    save.mockResolvedValue({
      _id: new Types.ObjectId('64b7f8f8f8f8f8f8f8f8f8f8'),
    });

    await service.createFromQueueMessage({
      kind: 'queue',
      queue: NotificationQueue.COURSE_APPROVAL,
      title: 'Yêu cầu duyệt khóa học',
      message: 'Một khóa học cần được duyệt.',
      triggerKey: 'course-publication-request:course-1',
      triggerDate: '2026-09-24',
    });

    expect(exists).toHaveBeenCalledWith({
      triggerKey: 'course-publication-request:course-1',
      targetUserId: 'queue:course_approval',
      triggerDate: '2026-09-24',
    });
    expect(notificationModel).toHaveBeenCalledWith(
      expect.objectContaining({
        type: NotificationType.QUEUE,
        queue: NotificationQueue.COURSE_APPROVAL,
        userId: undefined,
        targetUserId: 'queue:course_approval',
      }),
    );
  });

  it('returns a successful no-op when a queued notification already exists', async () => {
    exists.mockResolvedValue({ _id: 'existing-id' });

    const result = await service.createFromQueueMessage({
      kind: 'direct',
      targetUserId: 'user-1',
      title: 'Payment success',
      message: 'Your payment succeeded',
      triggerKey: 'payment-success:tx-1',
      triggerDate: '2026-09-24',
    });

    expect(save).not.toHaveBeenCalled();
    expect(result).toEqual({ created: false, duplicate: true });
  });

  it('treats duplicate-key errors as successful queued notification no-ops', async () => {
    const duplicateKeyError = Object.assign(new Error('duplicate key'), {
      code: 11000,
    });
    exists.mockResolvedValue(null);
    save.mockRejectedValue(duplicateKeyError);

    const result = await service.createFromQueueMessage({
      kind: 'direct',
      targetUserId: 'user-1',
      title: 'Payment success',
      message: 'Your payment succeeded',
      triggerKey: 'payment-success:tx-1',
      triggerDate: '2026-09-24',
    });

    expect(result).toEqual({ created: false, duplicate: true });
  });

  it('deletes a notification by id for cross-store compensation', async () => {
    const notificationId = new Types.ObjectId('64b7f8f8f8f8f8f8f8f8f8f8');
    findByIdAndDelete.mockResolvedValue({ _id: notificationId });

    await service.deleteNotification(notificationId);

    expect(findByIdAndDelete).toHaveBeenCalledWith(notificationId);
  });

  it('lists direct user notifications with pagination', async () => {
    const sort = jest.fn().mockReturnThis();
    const skip = jest.fn().mockReturnThis();
    const limit = jest.fn().mockResolvedValue([
      {
        _id: new Types.ObjectId('64b7f8f8f8f8f8f8f8f8f8f8'),
        type: NotificationType.DIRECT,
        userId: 'user-id',
        title: 'Khóa học đã được duyệt',
        message: 'Khóa học đã được xuất bản.',
        actionUrl: '/instructor/courses/course-id/edit',
        metadata: { courseId: 'course-id' },
        sentAt: new Date('2026-01-01T00:00:00Z'),
        seen: false,
      },
    ]);
    find.mockReturnValue({ sort, skip, limit });
    countDocuments.mockResolvedValue(11);

    const result = await service.findMine(
      { id: 'user-id', role: UserRole.INSTRUCTOR },
      { page: 2, limit: 10 },
    );

    expect(find).toHaveBeenCalledWith({ userId: 'user-id' });
    expect(countDocuments).toHaveBeenCalledWith({ userId: 'user-id' });
    expect(sort).toHaveBeenCalledWith({ sentAt: -1, createdAt: -1 });
    expect(skip).toHaveBeenCalledWith(10);
    expect(limit).toHaveBeenCalledWith(10);
    expect(result).toEqual({
      items: [
        {
          id: '64b7f8f8f8f8f8f8f8f8f8f8',
          type: NotificationType.DIRECT,
          title: 'Khóa học đã được duyệt',
          message: 'Khóa học đã được xuất bản.',
          metadata: { courseId: 'course-id' },
          actionUrl: '/instructor/courses/course-id/edit',
          sentAt: new Date('2026-01-01T00:00:00Z'),
          seen: false,
        },
      ],
      total: 11,
      page: 2,
      limit: 10,
      totalPages: 2,
    });
  });

  it('includes course approval queue notifications for admins', async () => {
    const sort = jest.fn().mockReturnThis();
    const skip = jest.fn().mockReturnThis();
    const limit = jest.fn().mockResolvedValue([]);
    find.mockReturnValue({ sort, skip, limit });
    countDocuments.mockResolvedValue(0);

    await service.findMine(
      { id: 'admin-id', role: UserRole.ADMIN },
      { page: 1, limit: 10 },
    );

    expect(find).toHaveBeenCalledWith({
      $or: [
        { userId: 'admin-id' },
        { queue: NotificationQueue.COURSE_APPROVAL },
      ],
    });
  });

  it('counts unseen notifications for the current user', async () => {
    countDocuments.mockResolvedValue(3);

    await expect(
      service.countUnread({ id: 'user-id', role: UserRole.INSTRUCTOR }),
    ).resolves.toEqual({ count: 3 });

    expect(countDocuments).toHaveBeenCalledWith({
      userId: 'user-id',
      seen: { $ne: true },
    });
  });

  it('marks an owned notification as seen', async () => {
    const updated = {
      _id: new Types.ObjectId('64b7f8f8f8f8f8f8f8f8f8f8'),
      type: NotificationType.DIRECT,
      userId: 'user-id',
      title: 'Khóa học đã được duyệt',
      message: 'Khóa học đã được xuất bản.',
      metadata: {},
      sentAt: new Date('2026-01-01T00:00:00Z'),
      seen: true,
    };
    findOneAndUpdate.mockResolvedValue(updated);

    const result = await service.markAsSeen('64b7f8f8f8f8f8f8f8f8f8f8', {
      id: 'user-id',
      role: UserRole.INSTRUCTOR,
    });

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { _id: '64b7f8f8f8f8f8f8f8f8f8f8', userId: 'user-id' },
      { seen: true },
      { returnDocument: 'after' },
    );
    expect(result.seen).toBe(true);
  });

  it('marks all visible learner notifications as seen', async () => {
    updateMany.mockResolvedValue({ modifiedCount: 2 });

    const result = await service.markAllAsSeen({
      id: 'user-1',
      role: UserRole.LEARNER,
    });

    expect(updateMany).toHaveBeenCalledWith(
      { userId: 'user-1', seen: { $ne: true } },
      { seen: true },
    );
    expect(result).toEqual({ modifiedCount: 2 });
  });

  it('marks all visible admin notifications as seen', async () => {
    updateMany.mockResolvedValue({ modifiedCount: 3 });

    const result = await service.markAllAsSeen({
      id: 'admin-1',
      role: UserRole.ADMIN,
    });

    expect(updateMany).toHaveBeenCalledWith(
      {
        $or: [
          { userId: 'admin-1' },
          { queue: NotificationQueue.COURSE_APPROVAL },
        ],
        seen: { $ne: true },
      },
      { seen: true },
    );
    expect(result).toEqual({ modifiedCount: 3 });
  });

  it('throws NotFoundException when marking another user notification seen', async () => {
    findOneAndUpdate.mockResolvedValue(null);

    await expect(
      service.markAsSeen('64b7f8f8f8f8f8f8f8f8f8f8', {
        id: 'user-id',
        role: UserRole.INSTRUCTOR,
      }),
    ).rejects.toThrow(NotFoundException);
  });
});
