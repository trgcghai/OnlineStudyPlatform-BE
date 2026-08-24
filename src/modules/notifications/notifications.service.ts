import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Notification,
  NotificationDocument,
  NotificationQueue,
  NotificationType,
} from './entities/notification.entity';

export interface CreateQueueNotificationInput {
  queue: NotificationQueue;
  title: string;
  message: string;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
  sentAt?: Date;
}

export interface CreatedNotificationRef {
  _id: Types.ObjectId | string;
}

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
    });

    return notification.save();
  }

  async deleteNotification(id: Types.ObjectId | string): Promise<void> {
    await this.notificationModel.findByIdAndDelete(id);
  }
}
