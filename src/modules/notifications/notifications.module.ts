import { Module } from '@nestjs/common';
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

@Module({
  imports: [
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
    NotificationsGateway,
    AccessTokenUserValidatorService,
  ],
  exports: [NotificationsService, NotificationsQueueService],
})
export class NotificationsModule {}
