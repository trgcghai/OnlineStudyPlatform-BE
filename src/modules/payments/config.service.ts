import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  DEFAULT_PAYMENT_CONFIG,
  EARNING_HOLD_DAYS_MIN,
  ListPaymentConfigAuditsQueryDto,
  MINIMUM_WITHDRAWAL_AMOUNT_MIN,
  MINIMUM_WITHDRAWAL_AMOUNT_STEP,
  PaymentConfigAuditListResult,
  PaymentConfigAuditResponse,
  PaymentConfigCurrency,
  PaymentConfigResponse,
  PaymentConfigSnapshot,
  UpdatePaymentConfigDto,
} from './dto/config.dto';
import {
  PaymentConfigAudit,
  PaymentConfigAuditDocument,
} from './schemas/config-audit.schema';
import { PaymentConfig, PaymentConfigDocument } from './schemas/config.schema';

const PAYMENT_CONFIG_SINGLETON_KEY = 'active';

@Injectable()
export class ConfigService implements OnModuleInit {
  private cachedConfig: PaymentConfigResponse | null = null;

  constructor(
    @InjectModel(PaymentConfig.name)
    private readonly configModel: Model<PaymentConfigDocument>,
    @InjectModel(PaymentConfigAudit.name)
    private readonly auditModel: Model<PaymentConfigAuditDocument>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.ensureDefaultConfig();
  }

  async ensureDefaultConfig(): Promise<void> {
    const existing = await this.configModel
      .findOne({ singletonKey: PAYMENT_CONFIG_SINGLETON_KEY })
      .exec();
    if (existing) {
      this.cachedConfig = this.toConfigResponse(existing);
      return;
    }

    try {
      const created = await this.configModel.create({
        ...DEFAULT_PAYMENT_CONFIG,
        allowedPrices: [...DEFAULT_PAYMENT_CONFIG.allowedPrices],
        singletonKey: PAYMENT_CONFIG_SINGLETON_KEY,
      });
      this.cachedConfig = this.toConfigResponse(created);
    } catch (error) {
      const persistenceError = error as { code?: unknown };
      if (persistenceError.code !== 11000) throw error;

      const createdElsewhere = await this.configModel
        .findOne({ singletonKey: PAYMENT_CONFIG_SINGLETON_KEY })
        .exec();
      if (!createdElsewhere) throw error;

      this.cachedConfig = this.toConfigResponse(createdElsewhere);
    }
  }

  async getActiveConfig(): Promise<PaymentConfigResponse> {
    if (this.cachedConfig) return this.cloneConfigResponse(this.cachedConfig);

    await this.ensureDefaultConfig();

    if (!this.cachedConfig) {
      throw new BadRequestException('Payment configuration is not available');
    }

    return this.cloneConfigResponse(this.cachedConfig);
  }

  async updateConfig(
    actorId: string,
    actorEmail: string,
    dto: UpdatePaymentConfigDto,
  ): Promise<PaymentConfigResponse> {
    await this.ensureDefaultConfig();
    const current = await this.configModel
      .findOne({ singletonKey: PAYMENT_CONFIG_SINGLETON_KEY })
      .exec();

    if (!current) {
      throw new BadRequestException('Payment configuration is not available');
    }

    const previousValue = this.toSnapshot(current);
    const normalized = this.normalizeUpdateDto(dto);
    const changedFields = this.getChangedFields(previousValue, normalized);

    if (changedFields.length === 0) {
      const response = this.toConfigResponse(current);
      this.cachedConfig = response;
      return this.cloneConfigResponse(response);
    }

    current.platformFeePercent = normalized.platformFeePercent;
    current.currency = normalized.currency;
    current.allowedPrices = normalized.allowedPrices;
    current.freeCourseLimit = normalized.freeCourseLimit;
    current.minimumWithdrawalAmount = normalized.minimumWithdrawalAmount;
    current.earningHoldDays = normalized.earningHoldDays;
    current.updatedById = actorId;

    const saved = await current.save();
    await this.auditModel.create({
      configId: this.getDocumentId(saved),
      actorId,
      actorEmail,
      previousValue,
      newValue: this.toSnapshot(saved),
      changedFields,
    });

    const response = this.toConfigResponse(saved);
    this.cachedConfig = response;
    return this.cloneConfigResponse(response);
  }

  async listAudits(
    query: ListPaymentConfigAuditsQueryDto,
  ): Promise<PaymentConfigAuditListResult> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const total = await this.auditModel.countDocuments().exec();
    const audits = await this.auditModel
      .find()
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .exec();

    return {
      items: audits.map((audit) => this.toAuditResponse(audit)),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async assertCoursePriceAllowed(price: number): Promise<void> {
    const config = await this.getActiveConfig();

    if (!config.allowedPrices.includes(price)) {
      throw new BadRequestException('Course price is not allowed');
    }
  }

  async getCoursePricingReference(): Promise<{
    currency: PaymentConfigCurrency;
    allowedPrices: number[];
  }> {
    const config = await this.getActiveConfig();

    return {
      currency: config.currency,
      allowedPrices: [...config.allowedPrices],
    };
  }

  async getFreeCourseLimit(): Promise<number | null> {
    return (await this.getActiveConfig()).freeCourseLimit;
  }

  async calculatePlatformFee(amount: number): Promise<number> {
    const config = await this.getActiveConfig();

    return Math.round((amount * config.platformFeePercent) / 100);
  }

  async calculateInstructorNet(amount: number): Promise<number> {
    return amount - (await this.calculatePlatformFee(amount));
  }

  private normalizeUpdateDto(
    dto: UpdatePaymentConfigDto,
  ): PaymentConfigSnapshot {
    if (
      !Number.isFinite(dto.platformFeePercent) ||
      dto.platformFeePercent < 0 ||
      dto.platformFeePercent > 100
    ) {
      throw new BadRequestException(
        'Platform fee percent must be between 0 and 100',
      );
    }

    if (dto.currency !== 'VND') {
      throw new BadRequestException('Currency must be VND');
    }

    if (!Array.isArray(dto.allowedPrices) || dto.allowedPrices.length === 0) {
      throw new BadRequestException('Allowed prices must not be empty');
    }

    const uniquePrices = new Set(dto.allowedPrices);
    if (uniquePrices.size !== dto.allowedPrices.length) {
      throw new BadRequestException('Allowed prices must be unique');
    }

    if (!dto.allowedPrices.includes(0)) {
      throw new BadRequestException('Allowed prices must include 0');
    }

    for (const price of dto.allowedPrices) {
      if (!Number.isInteger(price) || price < 0) {
        throw new BadRequestException(
          'Allowed prices must be non-negative integers',
        );
      }
    }

    if (
      dto.freeCourseLimit !== null &&
      (!Number.isInteger(dto.freeCourseLimit) || dto.freeCourseLimit < 0)
    ) {
      throw new BadRequestException(
        'Free course limit must be null or a non-negative integer',
      );
    }

    if (
      !Number.isInteger(dto.minimumWithdrawalAmount) ||
      dto.minimumWithdrawalAmount < MINIMUM_WITHDRAWAL_AMOUNT_MIN ||
      dto.minimumWithdrawalAmount % MINIMUM_WITHDRAWAL_AMOUNT_STEP !== 0
    ) {
      throw new BadRequestException(
        'Minimum withdrawal amount must be at least 1000000 and use 100000 increments',
      );
    }

    if (
      !Number.isInteger(dto.earningHoldDays) ||
      dto.earningHoldDays < EARNING_HOLD_DAYS_MIN
    ) {
      throw new BadRequestException(
        'Earning hold days must be a non-negative integer',
      );
    }

    return {
      platformFeePercent: dto.platformFeePercent,
      currency: 'VND',
      allowedPrices: [...dto.allowedPrices].sort((a, b) => a - b),
      freeCourseLimit: dto.freeCourseLimit,
      minimumWithdrawalAmount: dto.minimumWithdrawalAmount,
      earningHoldDays: dto.earningHoldDays,
      updatedById: null,
    };
  }

  private getChangedFields(
    previousValue: PaymentConfigSnapshot,
    newValue: PaymentConfigSnapshot,
  ): string[] {
    const fields: Array<keyof PaymentConfigSnapshot> = [
      'platformFeePercent',
      'currency',
      'allowedPrices',
      'freeCourseLimit',
      'minimumWithdrawalAmount',
      'earningHoldDays',
    ];

    return fields.filter((field) => {
      const previous = previousValue[field];
      const next = newValue[field];

      if (Array.isArray(previous) && Array.isArray(next)) {
        return previous.join(',') !== next.join(',');
      }

      return previous !== next;
    });
  }

  private toSnapshot(config: PaymentConfigDocument): PaymentConfigSnapshot {
    return {
      platformFeePercent: config.platformFeePercent,
      currency: config.currency,
      allowedPrices: [...config.allowedPrices],
      freeCourseLimit: config.freeCourseLimit,
      minimumWithdrawalAmount: config.minimumWithdrawalAmount,
      earningHoldDays:
        config.earningHoldDays ?? DEFAULT_PAYMENT_CONFIG.earningHoldDays,
      updatedById: config.updatedById,
    };
  }

  private toConfigResponse(
    config: PaymentConfigDocument,
  ): PaymentConfigResponse {
    return {
      id: this.getDocumentId(config),
      ...this.toSnapshot(config),
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
    };
  }

  private cloneConfigResponse(
    config: PaymentConfigResponse,
  ): PaymentConfigResponse {
    return {
      ...config,
      allowedPrices: [...config.allowedPrices],
    };
  }

  private toAuditResponse(
    audit: PaymentConfigAuditDocument,
  ): PaymentConfigAuditResponse {
    return {
      id: this.getDocumentId(audit),
      configId: audit.configId,
      actorEmail: audit.actorEmail,
      previousValue: audit.previousValue,
      newValue: audit.newValue,
      changedFields: audit.changedFields,
      createdAt: audit.createdAt,
    };
  }

  private getDocumentId(document: { _id?: unknown; id?: string }): string {
    if (document.id) return document.id;

    return String(document._id);
  }
}
