import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Course } from '../courses/entities/course.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { ConfigController } from './config.controller';
import { ConfigService } from './config.service';
import { PaymentAuditLog } from './entities/payment-audit.entity';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import {
  PaymentConfigAudit,
  PaymentConfigAuditSchema,
} from './schemas/config-audit.schema';
import { PaymentConfig, PaymentConfigSchema } from './schemas/config.schema';
import { SePayAuthGuard } from './sepay-auth.guard';
import { SePayWebhookController } from './sepay.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaymentTransaction,
      PaymentAuditLog,
      Course,
      Enrollment,
    ]),
    MongooseModule.forFeature([
      { name: PaymentConfig.name, schema: PaymentConfigSchema },
      { name: PaymentConfigAudit.name, schema: PaymentConfigAuditSchema },
    ]),
    NotificationsModule,
  ],
  controllers: [PaymentsController, SePayWebhookController, ConfigController],
  providers: [PaymentsService, SePayAuthGuard, ConfigService],
  exports: [PaymentsService, ConfigService],
})
export class PaymentsModule {}
