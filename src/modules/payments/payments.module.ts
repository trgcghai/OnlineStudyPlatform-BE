import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Course } from '../courses/entities/course.entity';
import { Enrollment } from '../enrollments/entities/enrollment.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { InstructorAccount } from '../users/entities/instructor-account.entity';
import { User } from '../users/entities/user.entity';
import { SePayAuthGuard } from '../../common/guards/sepay-auth.guard';
import { ConfigService } from './config.service';
import { InstructorBalanceLedger } from './entities/instructor-balance-ledger.entity';
import { PaymentAuditLog } from './entities/payment-audit.entity';
import { PaymentProviderEvent } from './entities/payment-provider-event.entity';
import { PaymentTransaction } from './entities/payment-transaction.entity';
import { WithdrawRequest } from './entities/withdraw-request.entity';
import { InstructorBalanceService } from './instructor-balance.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PaymentTransactionCleanupService } from './payment-transaction-cleanup.service';
import {
  PaymentConfigAudit,
  PaymentConfigAuditSchema,
} from './schemas/config-audit.schema';
import { PaymentConfig, PaymentConfigSchema } from './schemas/config.schema';
import { SePayWebhookController } from './sepay.controller';
import { WithdrawController } from './withdraw.controller';
import { WithdrawService } from './withdraw.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PaymentTransaction,
      PaymentAuditLog,
      PaymentProviderEvent,
      WithdrawRequest,
      InstructorBalanceLedger,
      Course,
      Enrollment,
      User,
      InstructorAccount,
    ]),
    MongooseModule.forFeature([
      { name: PaymentConfig.name, schema: PaymentConfigSchema },
      { name: PaymentConfigAudit.name, schema: PaymentConfigAuditSchema },
    ]),
    NotificationsModule,
  ],
  controllers: [PaymentsController, SePayWebhookController, WithdrawController],
  providers: [
    PaymentsService,
    WithdrawService,
    InstructorBalanceService,
    PaymentTransactionCleanupService,
    SePayAuthGuard,
    ConfigService,
  ],
  exports: [PaymentsService, ConfigService],
})
export class PaymentsModule {}
