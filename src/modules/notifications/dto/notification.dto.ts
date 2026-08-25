import { PartialType } from '@nestjs/mapped-types';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { Types } from 'mongoose';
import {
  NotificationQueue,
  NotificationType,
} from '../entities/notification.entity';

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

export interface CreateDirectNotificationInput {
  userId: string;
  title: string;
  message: string;
  actionUrl?: string;
  metadata?: Record<string, unknown>;
  sentAt?: Date;
}

export interface CreatedNotificationRef {
  _id: Types.ObjectId | string;
}

export class ListNotificationsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;
}

export interface NotificationResponse {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  metadata: Record<string, unknown>;
  actionUrl: string | null;
  sentAt: Date;
  seen: boolean;
}

export interface NotificationListResult {
  items: NotificationResponse[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface UnreadNotificationCountResult {
  count: number;
}
