import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthenticatedUser } from '../auth/dto/auth.dto';
import { UserRole } from '../users/entities/user.entity';
import {
  CreatedNotificationRef,
  CreateDirectNotificationInput,
  CreateQueueNotificationInput,
  ListNotificationsQueryDto,
  NotificationListResult,
  NotificationResponse,
  UnreadNotificationCountResult,
} from './dto/notification.dto';
import {
  Notification,
  NotificationDocument,
  NotificationQueue,
  NotificationType,
} from './entities/notification.entity';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
  ) {}

  async createQueueNotification(
    input: CreateQueueNotificationInput,
  ): Promise<CreatedNotificationRef> {
    const notification = new this.notificationModel({
      type: NotificationType.QUEUE,
      queue: input.queue,
      title: input.title,
      message: input.message,
      actionUrl: input.actionUrl,
      metadata: input.metadata ?? {},
      sentAt: input.sentAt ?? new Date(),
      seen: false,
    });

    return notification.save();
  }

  async createDirectNotification(
    input: CreateDirectNotificationInput,
  ): Promise<CreatedNotificationRef> {
    const notification = new this.notificationModel({
      type: NotificationType.DIRECT,
      userId: input.userId,
      title: input.title,
      message: input.message,
      actionUrl: input.actionUrl,
      metadata: input.metadata ?? {},
      sentAt: input.sentAt ?? new Date(),
      seen: false,
    });

    return notification.save();
  }

  async findMine(
    user: Pick<AuthenticatedUser, 'id' | 'role'>,
    query: ListNotificationsQueryDto,
  ): Promise<NotificationListResult> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const filter = this.buildUserNotificationFilter(user);

    const [items, total] = await Promise.all([
      this.notificationModel
        .find(filter)
        .sort({ sentAt: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      this.notificationModel.countDocuments(filter),
    ]);

    return {
      items: items.map((notification) =>
        this.toNotificationResponse(notification),
      ),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async countUnread(
    user: Pick<AuthenticatedUser, 'id' | 'role'>,
  ): Promise<UnreadNotificationCountResult> {
    const count = await this.notificationModel.countDocuments({
      ...this.buildUserNotificationFilter(user),
      seen: { $ne: true },
    });

    return { count };
  }

  async markAsSeen(
    id: string,
    user: Pick<AuthenticatedUser, 'id' | 'role'>,
  ): Promise<NotificationResponse> {
    const notification = await this.notificationModel.findOneAndUpdate(
      { _id: id, ...this.buildUserNotificationFilter(user) },
      { seen: true },
      { new: true },
    );

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    return this.toNotificationResponse(notification);
  }

  async deleteNotification(id: Types.ObjectId | string): Promise<void> {
    await this.notificationModel.findByIdAndDelete(id);
  }

  private buildUserNotificationFilter(
    user: Pick<AuthenticatedUser, 'id' | 'role'>,
  ): Record<string, unknown> {
    if (user.role === UserRole.ADMIN) {
      return {
        $or: [
          { userId: user.id },
          { queue: NotificationQueue.COURSE_APPROVAL },
        ],
      };
    }

    return { userId: user.id };
  }

  private toNotificationResponse(
    notification: NotificationDocument,
  ): NotificationResponse {
    return {
      id: notification._id.toString(),
      type: notification.type,
      title: notification.title,
      message: notification.message,
      metadata: notification.metadata ?? {},
      actionUrl: notification.actionUrl ?? null,
      sentAt: notification.sentAt ?? new Date(),
      seen: notification.seen ?? false,
    };
  }
}
