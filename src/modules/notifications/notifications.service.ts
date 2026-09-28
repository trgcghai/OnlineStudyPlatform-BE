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
  MarkAllNotificationsSeenResult,
  NotificationCreateMessage,
  NotificationListResult,
  NotificationResponse,
  QueueNotificationCreateResult,
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

  async createFromQueueMessage(
    message: NotificationCreateMessage,
  ): Promise<QueueNotificationCreateResult> {
    const targetUserId = this.resolveTargetUserId(message);
    const existing = await this.notificationModel.exists({
      triggerKey: message.triggerKey,
      targetUserId,
      triggerDate: message.triggerDate,
    });

    if (existing) {
      return { created: false, duplicate: true };
    }

    try {
      const notification = new this.notificationModel({
        type:
          message.kind === 'direct'
            ? NotificationType.DIRECT
            : NotificationType.QUEUE,
        userId: message.kind === 'direct' ? message.targetUserId : undefined,
        queue: message.kind === 'queue' ? message.queue : undefined,
        title: message.title,
        message: message.message,
        actionUrl: message.actionUrl,
        metadata: message.metadata ?? {},
        sentAt: message.sentAt ? new Date(message.sentAt) : new Date(),
        seen: false,
        triggerKey: message.triggerKey,
        triggerDate: message.triggerDate,
        targetUserId,
      });

      const saved = await notification.save();

      return {
        created: true,
        duplicate: false,
        notificationId: saved._id.toString(),
      };
    } catch (error) {
      if (this.isDuplicateKeyError(error)) {
        return { created: false, duplicate: true };
      }

      throw error;
    }
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
      { returnDocument: 'after' },
    );

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    return this.toNotificationResponse(notification);
  }

  async markAllAsSeen(
    user: Pick<AuthenticatedUser, 'id' | 'role'>,
  ): Promise<MarkAllNotificationsSeenResult> {
    const result = await this.notificationModel.updateMany(
      {
        ...this.buildUserNotificationFilter(user),
        seen: { $ne: true },
      },
      { seen: true },
    );

    return { modifiedCount: result.modifiedCount ?? 0 };
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

  private resolveTargetUserId(message: NotificationCreateMessage): string {
    if (message.kind === 'direct') {
      return message.targetUserId ?? '';
    }

    return `queue:${message.queue}`;
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: number }).code === 11000
    );
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
