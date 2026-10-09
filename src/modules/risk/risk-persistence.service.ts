import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage } from 'mongoose';
import { RiskBand, RiskScoreResponse } from './dto/risk.dto';
import { RiskScore, RiskScoreDocument } from './schemas/risk-score.schema';

export interface RiskLearnerFilters {
  threshold?: number;
  band?: RiskBand;
}

@Injectable()
export class RiskPersistenceService {
  constructor(
    @InjectModel(RiskScore.name)
    private readonly riskScoreModel: Model<RiskScoreDocument>,
  ) {}

  async upsertScore(
    jobKey: string,
    score: RiskScoreResponse,
  ): Promise<RiskScoreResponse> {
    return this.riskScoreModel
      .findOneAndUpdate(
        { jobKey },
        { $set: { ...score, jobKey } },
        { new: true, upsert: true },
      )
      .exec();
  }

  async findLatestByCourse(
    courseId: string,
    filters: RiskLearnerFilters = {},
  ): Promise<RiskScoreResponse[]> {
    const match: Record<string, unknown> = {};
    if (filters.threshold !== undefined)
      match.score = { $gte: filters.threshold };
    if (filters.band) match.band = filters.band;

    const pipeline: PipelineStage[] = [
      { $match: { courseId } },
      { $sort: { learnerId: 1, calculatedAt: -1 } },
      { $group: { _id: '$learnerId', latest: { $first: '$$ROOT' } } },
      { $replaceRoot: { newRoot: '$latest' } },
    ];

    if (Object.keys(match).length > 0) {
      pipeline.push({ $match: match });
    }

    pipeline.push({ $sort: { score: -1, calculatedAt: -1 } });

    return this.riskScoreModel.aggregate<RiskScoreResponse>(pipeline).exec();
  }

  async findHistory(
    learnerId: string,
    courseId: string,
  ): Promise<RiskScoreResponse[]> {
    return this.riskScoreModel
      .find({ learnerId, courseId })
      .sort({ calculatedAt: -1 })
      .exec();
  }
}
