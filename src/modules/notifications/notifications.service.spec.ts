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

  beforeEach(() => {
    save = jest.fn();
    findByIdAndDelete = jest.fn();
    find = jest.fn();
    countDocuments = jest.fn();
    findOneAndUpdate = jest.fn();
    notificationModel = jest.fn().mockImplementation((input: unknown) => ({
      ...input,
      _id: new Types.ObjectId('64b7f8f8f8f8f8f8f8f8f8f8'),
      save,
    }));
    notificationModel.findByIdAndDelete = findByIdAndDelete;
    notificationModel.find = find;
    notificationModel.countDocuments = countDocuments;
    notificationModel.findOneAndUpdate = findOneAndUpdate;

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

    const result = await service.markAsSeen(
      '64b7f8f8f8f8f8f8f8f8f8f8',
      { id: 'user-id', role: UserRole.INSTRUCTOR },
    );

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { _id: '64b7f8f8f8f8f8f8f8f8f8f8', userId: 'user-id' },
      { seen: true },
      { new: true },
    );
    expect(result.seen).toBe(true);
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
