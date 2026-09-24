import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type NotificationDocument = HydratedDocument<Notification>;

export enum NotificationType {
  DIRECT = 'direct',
  QUEUE = 'queue',
}

export enum NotificationQueue {
  COURSE_APPROVAL = 'course_approval',
}

@Schema({
  timestamps: true,
})
export class Notification {
  @Prop({
    type: String,
    enum: NotificationType,
    required: true,
    index: true,
  })
  type!: NotificationType;

  @Prop({
    type: String,
    required: false,
    index: true,
  })
  userId?: string;

  @Prop({
    type: String,
    enum: NotificationQueue,
    required: false,
    index: true,
  })
  queue?: NotificationQueue;

  @Prop({
    type: String,
    required: true,
  })
  title!: string;

  @Prop({
    type: String,
    required: true,
  })
  message!: string;

  @Prop({
    type: String,
    required: false,
  })
  actionUrl?: string;

  @Prop({
    type: Object,
    default: {},
  })
  metadata?: Record<string, unknown>;

  @Prop({
    type: Boolean,
    default: false,
    index: true,
  })
  seen!: boolean;

  @Prop({
    type: Date,
    required: false,
  })
  sentAt?: Date;

  @Prop({
    type: String,
    required: false,
    index: true,
  })
  triggerKey?: string;

  @Prop({
    type: String,
    required: false,
    index: true,
  })
  triggerDate?: string;

  @Prop({
    type: String,
    required: false,
    index: true,
  })
  targetUserId?: string;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

NotificationSchema.index(
  { triggerKey: 1, targetUserId: 1, triggerDate: 1 },
  {
    unique: true,
    partialFilterExpression: {
      triggerKey: { $exists: true },
      targetUserId: { $exists: true },
      triggerDate: { $exists: true },
    },
  },
);
