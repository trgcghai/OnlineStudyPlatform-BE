import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigController } from './config.controller';
import { ConfigService } from './config.service';
import {
  PaymentConfigAudit,
  PaymentConfigAuditSchema,
} from './schemas/config-audit.schema';
import { PaymentConfig, PaymentConfigSchema } from './schemas/config.schema';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PaymentConfig.name, schema: PaymentConfigSchema },
      { name: PaymentConfigAudit.name, schema: PaymentConfigAuditSchema },
    ]),
  ],
  controllers: [ConfigController],
  providers: [ConfigService],
  exports: [ConfigService],
})
export class PaymentConfigModule {}
