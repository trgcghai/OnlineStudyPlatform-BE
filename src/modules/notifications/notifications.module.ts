import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { AccessTokenUserValidatorService } from '../../common/services/access-token-user-validator.service';
import { UsersModule } from '../users/users.module';
import {
  Notification,
  NotificationSchema,
} from './entities/notification.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsQueueService } from './notifications-queue.service';
import { NotificationsService } from './notifications.service';
import { NOTIFICATION_QUEUE } from './notification-queue.constants';
import { NotificationsQueueProcessor } from './notifications-queue.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: NOTIFICATION_QUEUE }),
    JwtModule.register({}),
    UsersModule,
    MongooseModule.forFeature([
      { name: Notification.name, schema: NotificationSchema },
    ]),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsQueueService,
    NotificationsQueueProcessor,
    NotificationsGateway,
    AccessTokenUserValidatorService,
  ],
  exports: [NotificationsService, NotificationsQueueService],
})
export class NotificationsModule {}
