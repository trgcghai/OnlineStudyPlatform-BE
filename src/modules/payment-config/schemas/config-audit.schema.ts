import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import type { PaymentConfigSnapshot } from '../dto/config.dto';

export type PaymentConfigAuditDocument = HydratedDocument<PaymentConfigAudit>;

@Schema({
  collection: 'payment_config_audits',
  timestamps: { createdAt: true, updatedAt: false },
})
export class PaymentConfigAudit {
  @Prop({ required: true, type: String })
  configId!: string;

  @Prop({ required: true, type: String })
  actorId!: string;

  @Prop({ required: true, type: String })
  actorEmail!: string;

  @Prop({ required: true, type: MongooseSchema.Types.Mixed })
  previousValue!: PaymentConfigSnapshot;

  @Prop({ required: true, type: MongooseSchema.Types.Mixed })
  newValue!: PaymentConfigSnapshot;

  @Prop({ required: true, type: [String], default: [] })
  changedFields!: string[];

  createdAt!: Date;
}

export const PaymentConfigAuditSchema =
  SchemaFactory.createForClass(PaymentConfigAudit);
