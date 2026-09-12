import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Course } from '../courses/entities/course.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { SePayAuthGuard } from '../../common/guards/sepay-auth.guard';
import { ConfigService } from './config.service';
import { PaymentAuditLog } from './entities/payment-audit.entity';
import { PaymentProviderEvent } from './entities/payment-provider-event.entity';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import {
  PaymentConfigAudit,
  PaymentConfigAuditSchema,
} from './schemas/config-audit.schema';
import { PaymentConfig, PaymentConfigSchema } from './schemas/config.schema';
import { SePayWebhookController } from './sepay.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaymentTransaction,
      PaymentAuditLog,
      PaymentProviderEvent,
      Course,
      Enrollment,
    ]),
    MongooseModule.forFeature([
      { name: PaymentConfig.name, schema: PaymentConfigSchema },
      { name: PaymentConfigAudit.name, schema: PaymentConfigAuditSchema },
    ]),
    NotificationsModule,
  ],
  controllers: [PaymentsController, SePayWebhookController],
  providers: [PaymentsService, SePayAuthGuard, ConfigService],
  exports: [PaymentsService, ConfigService],
})
export class PaymentsModule {}
