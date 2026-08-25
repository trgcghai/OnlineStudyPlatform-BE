import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CreatedNotificationRef,
  CreateDirectNotificationInput,
  CreateQueueNotificationInput,
} from './dto/notification.dto';
import {
  Notification,
  NotificationDocument,
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
    });

    return notification.save();
  }

  async deleteNotification(id: Types.ObjectId | string): Promise<void> {
    await this.notificationModel.findByIdAndDelete(id);
  }
}
