import { PartialType } from '@nestjs/mapped-types';
import { Types } from 'mongoose';
import { NotificationQueue } from '../entities/notification.entity';

export class CreateNotificationDto {}

export class UpdateNotificationDto extends PartialType(CreateNotificationDto) {}

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
