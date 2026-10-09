import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { RiskBand } from '../dto/risk.dto';
import type { RiskFactor, RiskFeatures, RiskSource } from '../dto/risk.dto';

export type RiskScoreDocument = HydratedDocument<RiskScore>;

@Schema({ collection: 'risk_scores', timestamps: true })
export class RiskScore {
  @Prop({ required: true, type: String })
  learnerId!: string;

  @Prop({ required: true, type: String })
  courseId!: string;

  @Prop({ required: true, type: String })
  enrollmentId!: string;

  @Prop({ required: true, type: Date })
  calculatedAt!: Date;

  @Prop({ required: true, type: Number, min: 0, max: 100 })
  score!: number;

  @Prop({ required: true, enum: Object.values(RiskBand), type: String })
  band!: RiskBand;

  @Prop({ required: true, type: String })
  featureVersion!: string;

  @Prop({ required: true, type: String })
  scoringVersion!: string;

  @Prop({ required: true, enum: ['heuristic', 'ai'], type: String })
  source!: RiskSource;

  @Prop({ required: true, type: Object })
  features!: RiskFeatures;

  @Prop({ required: true, type: [Object], default: [] })
  factors!: RiskFactor[];

  @Prop({ required: true, unique: true, type: String })
  jobKey!: string;
}

export const RiskScoreSchema = SchemaFactory.createForClass(RiskScore);

RiskScoreSchema.index({ jobKey: 1 }, { unique: true });
RiskScoreSchema.index({ courseId: 1, calculatedAt: -1 });
RiskScoreSchema.index({ learnerId: 1, courseId: 1, calculatedAt: -1 });
RiskScoreSchema.index({ courseId: 1, band: 1, score: -1, calculatedAt: -1 });
