import { Types } from 'mongoose';
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

  beforeEach(() => {
    save = jest.fn();
    findByIdAndDelete = jest.fn();
    notificationModel = jest.fn().mockImplementation((input: unknown) => ({
      ...input,
      _id: new Types.ObjectId('64b7f8f8f8f8f8f8f8f8f8f8'),
      save,
    }));
    notificationModel.findByIdAndDelete = findByIdAndDelete;

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
});
