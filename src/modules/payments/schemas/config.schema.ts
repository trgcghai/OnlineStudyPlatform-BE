import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import type { PaymentConfigCurrency } from '../dto/config.dto';

export type PaymentConfigDocument = HydratedDocument<PaymentConfig>;

@Schema({ collection: 'payment_configs', timestamps: true })
export class PaymentConfig {
  @Prop({ required: true, default: 'active', unique: true })
  singletonKey!: string;

  @Prop({ required: true, type: Number })
  platformFeePercent!: number;

  @Prop({ required: true, type: String, enum: ['VND'], default: 'VND' })
  currency!: PaymentConfigCurrency;

  @Prop({ required: true, type: [Number], default: [] })
  allowedPrices!: number[];

  @Prop({ required: false, type: Number, default: null })
  freeCourseLimit!: number | null;

  @Prop({ required: true, type: Number })
  minimumWithdrawalAmount!: number;

  @Prop({ required: false, type: String, default: null })
  updatedById!: string | null;

  createdAt!: Date;
  updatedAt!: Date;
}

export const PaymentConfigSchema = SchemaFactory.createForClass(PaymentConfig);
