import { BadRequestException } from '@nestjs/common';
import { ConfigService as NestConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { ConfigService } from './config.service';
import {
  DEFAULT_PAYMENT_CONFIG,
  PaymentConfigCurrency,
  UpdatePaymentConfigDto,
} from './dto/config.dto';
import { PaymentConfig } from './schemas/config.schema';
import { PaymentConfigAudit } from './schemas/config-audit.schema';

const CONFIG_ID = 'config-id';
const ACTOR_ID = 'admin-id';
const ACTOR_EMAIL = 'admin@example.com';

function mockQuery<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}

function mockFindQuery<T>(value: T) {
  return {
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

function createConfig(overrides: Partial<PaymentConfig> = {}) {
  const config = {
    _id: { toString: () => CONFIG_ID },
    singletonKey: 'active',
    ...DEFAULT_PAYMENT_CONFIG,
    createdAt: new Date('2026-09-09T00:00:00.000Z'),
    updatedAt: new Date('2026-09-09T00:00:00.000Z'),
    save: jest.fn(),
    ...overrides,
  };

  config.save.mockResolvedValue(config);

  return config;
}

describe('ConfigService', () => {
  let service: ConfigService;
  let nestConfigService: { getOrThrow: jest.Mock };
  let configModel: {
    findOne: jest.Mock;
    create: jest.Mock;
  };
  let auditModel: {
    create: jest.Mock;
    countDocuments: jest.Mock;
    find: jest.Mock;
  };

  const updateDto: UpdatePaymentConfigDto = {
    platformFeePercent: 15,
    currency: 'VND',
    allowedPrices: [199000, 0, 99000],
    freeCourseLimit: 5,
    minimumWithdrawalAmount: 2000000,
    earningHoldDays: 14,
  };

  beforeEach(async () => {
    nestConfigService = { getOrThrow: jest.fn().mockReturnValue('production') };
    configModel = {
      findOne: jest.fn(),
      create: jest.fn(),
    };
    auditModel = {
      create: jest.fn(),
      countDocuments: jest.fn(),
      find: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ConfigService,
        { provide: NestConfigService, useValue: nestConfigService },
        { provide: getModelToken(PaymentConfig.name), useValue: configModel },
        {
          provide: getModelToken(PaymentConfigAudit.name),
          useValue: auditModel,
        },
      ],
    }).compile();

    service = moduleRef.get(ConfigService);
  });

  it('creates default config on module init when no config exists', async () => {
    configModel.findOne.mockReturnValue(mockQuery(null));
    configModel.create.mockResolvedValue(createConfig());

    await service.onModuleInit();

    expect(configModel.findOne).toHaveBeenCalledWith({
      singletonKey: 'active',
    });
    expect(configModel.create).toHaveBeenCalledWith({
      ...DEFAULT_PAYMENT_CONFIG,
      allowedPrices: [...DEFAULT_PAYMENT_CONFIG.allowedPrices],
      singletonKey: 'active',
    });
  });

  it('creates development default config with lower withdrawal minimum', async () => {
    nestConfigService.getOrThrow.mockReturnValue('development');
    configModel.findOne.mockReturnValue(mockQuery(null));
    configModel.create.mockResolvedValue(
      createConfig({ minimumWithdrawalAmount: 1000, earningHoldDays: 7 }),
    );

    await service.onModuleInit();

    expect(configModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        minimumWithdrawalAmount: 1000,
        earningHoldDays: 7,
        singletonKey: 'active',
      }),
    );
  });

  it('does not create default config when config already exists', async () => {
    configModel.findOne.mockReturnValue(mockQuery(createConfig()));

    await service.onModuleInit();

    expect(configModel.create).not.toHaveBeenCalled();
  });

  it('loads config created by another server when startup create hits duplicate key', async () => {
    configModel.findOne
      .mockReturnValueOnce(mockQuery(null))
      .mockReturnValueOnce(mockQuery(createConfig()));
    configModel.create.mockRejectedValue({ code: 11000 });

    await service.onModuleInit();

    await expect(service.getActiveConfig()).resolves.toMatchObject({
      id: CONFIG_ID,
      platformFeePercent: DEFAULT_PAYMENT_CONFIG.platformFeePercent,
    });
  });

  it('returns active config from cache after initialization', async () => {
    configModel.findOne.mockReturnValue(mockQuery(createConfig()));

    await service.onModuleInit();
    const result = await service.getActiveConfig();

    expect(result).toMatchObject({
      id: CONFIG_ID,
      platformFeePercent: DEFAULT_PAYMENT_CONFIG.platformFeePercent,
      currency: DEFAULT_PAYMENT_CONFIG.currency,
      allowedPrices: DEFAULT_PAYMENT_CONFIG.allowedPrices,
      freeCourseLimit: DEFAULT_PAYMENT_CONFIG.freeCourseLimit,
      minimumWithdrawalAmount: DEFAULT_PAYMENT_CONFIG.minimumWithdrawalAmount,
      earningHoldDays: DEFAULT_PAYMENT_CONFIG.earningHoldDays,
      updatedById: null,
    });
    expect(configModel.findOne).toHaveBeenCalledTimes(1);
  });

  it('returns a copy of cached config so consumers cannot mutate cache', async () => {
    configModel.findOne.mockReturnValue(mockQuery(createConfig()));

    await service.onModuleInit();
    const firstResult = await service.getActiveConfig();
    firstResult.allowedPrices.push(12345);
    const secondResult = await service.getActiveConfig();

    expect(secondResult.allowedPrices).toEqual(
      DEFAULT_PAYMENT_CONFIG.allowedPrices,
    );
  });

  it('updates config with normalized values and writes audit', async () => {
    const current = createConfig();
    const saved = createConfig({
      platformFeePercent: 15,
      allowedPrices: [0, 99000, 199000],
      freeCourseLimit: 5,
      minimumWithdrawalAmount: 2000000,
      earningHoldDays: 14,
      updatedById: ACTOR_ID,
    });
    current.save = jest.fn().mockResolvedValue(saved);
    configModel.findOne.mockReturnValue(mockQuery(current));
    auditModel.create.mockResolvedValue({
      _id: { toString: () => 'audit-id' },
    });

    const result = await service.updateConfig(ACTOR_ID, ACTOR_EMAIL, updateDto);

    expect(current.platformFeePercent).toBe(15);
    expect(current.allowedPrices).toEqual([0, 99000, 199000]);
    expect(current.earningHoldDays).toBe(14);
    expect(current.updatedById).toBe(ACTOR_ID);
    expect(auditModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        configId: CONFIG_ID,
        actorId: ACTOR_ID,
        actorEmail: ACTOR_EMAIL,
        changedFields: expect.arrayContaining([
          'platformFeePercent',
          'allowedPrices',
          'freeCourseLimit',
          'minimumWithdrawalAmount',
          'earningHoldDays',
        ]),
      }),
    );
    expect(result.platformFeePercent).toBe(15);
    expect(result.earningHoldDays).toBe(14);
  });

  it('allows earning hold days to be zero in development while keeping the default at seven days', async () => {
    nestConfigService.getOrThrow.mockReturnValue('development');
    const current = createConfig();
    const saved = createConfig({
      earningHoldDays: 0,
      updatedById: ACTOR_ID,
    });
    current.save = jest.fn().mockResolvedValue(saved);
    configModel.findOne.mockReturnValue(mockQuery(current));
    auditModel.create.mockResolvedValue({
      _id: { toString: () => 'audit-id' },
    });

    const result = await service.updateConfig(ACTOR_ID, ACTOR_EMAIL, {
      ...updateDto,
      earningHoldDays: 0,
    });

    expect(DEFAULT_PAYMENT_CONFIG.earningHoldDays).toBe(7);
    expect(current.earningHoldDays).toBe(0);
    expect(result.earningHoldDays).toBe(0);
  });

  it('allows the development withdrawal minimum and step', async () => {
    nestConfigService.getOrThrow.mockReturnValue('development');
    const current = createConfig();
    const saved = createConfig({
      minimumWithdrawalAmount: 1000,
      updatedById: ACTOR_ID,
    });
    current.save = jest.fn().mockResolvedValue(saved);
    configModel.findOne.mockReturnValue(mockQuery(current));
    auditModel.create.mockResolvedValue({
      _id: { toString: () => 'audit-id' },
    });

    const result = await service.updateConfig(ACTOR_ID, ACTOR_EMAIL, {
      ...updateDto,
      minimumWithdrawalAmount: 1000,
    });

    expect(current.minimumWithdrawalAmount).toBe(1000);
    expect(result.minimumWithdrawalAmount).toBe(1000);
  });

  it('rejects development withdrawal amount when it does not follow the development step', async () => {
    nestConfigService.getOrThrow.mockReturnValue('development');
    configModel.findOne.mockReturnValue(mockQuery(createConfig()));

    await expect(
      service.updateConfig(ACTOR_ID, ACTOR_EMAIL, {
        ...updateDto,
        minimumWithdrawalAmount: 1500,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects production earning hold days below seven days', async () => {
    configModel.findOne.mockReturnValue(mockQuery(createConfig()));

    await expect(
      service.updateConfig(ACTOR_ID, ACTOR_EMAIL, {
        ...updateDto,
        earningHoldDays: 0,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns current config without audit for no-op update', async () => {
    const current = createConfig({ updatedById: ACTOR_ID });
    configModel.findOne.mockReturnValue(mockQuery(current));

    const result = await service.updateConfig(ACTOR_ID, ACTOR_EMAIL, {
      platformFeePercent: DEFAULT_PAYMENT_CONFIG.platformFeePercent,
      currency: 'VND',
      allowedPrices: [...DEFAULT_PAYMENT_CONFIG.allowedPrices],
      freeCourseLimit: DEFAULT_PAYMENT_CONFIG.freeCourseLimit,
      minimumWithdrawalAmount: DEFAULT_PAYMENT_CONFIG.minimumWithdrawalAmount,
      earningHoldDays: DEFAULT_PAYMENT_CONFIG.earningHoldDays,
    });

    expect(current.save).not.toHaveBeenCalled();
    expect(auditModel.create).not.toHaveBeenCalled();
    expect(result.id).toBe(CONFIG_ID);
  });

  it('does not audit a no-op update when updatedById is empty', async () => {
    const current = createConfig({ updatedById: null });
    configModel.findOne.mockReturnValue(mockQuery(current));

    await service.updateConfig(ACTOR_ID, ACTOR_EMAIL, {
      platformFeePercent: DEFAULT_PAYMENT_CONFIG.platformFeePercent,
      currency: 'VND',
      allowedPrices: [...DEFAULT_PAYMENT_CONFIG.allowedPrices],
      freeCourseLimit: DEFAULT_PAYMENT_CONFIG.freeCourseLimit,
      minimumWithdrawalAmount: DEFAULT_PAYMENT_CONFIG.minimumWithdrawalAmount,
      earningHoldDays: DEFAULT_PAYMENT_CONFIG.earningHoldDays,
    });

    expect(current.updatedById).toBeNull();
    expect(current.save).not.toHaveBeenCalled();
    expect(auditModel.create).not.toHaveBeenCalled();
  });

  it('lists audits with pagination', async () => {
    const audit = {
      _id: { toString: () => 'audit-id' },
      configId: CONFIG_ID,
      actorId: ACTOR_ID,
      actorEmail: ACTOR_EMAIL,
      previousValue: { ...DEFAULT_PAYMENT_CONFIG },
      newValue: { ...DEFAULT_PAYMENT_CONFIG, platformFeePercent: 15 },
      changedFields: ['platformFeePercent'],
      createdAt: new Date('2026-09-09T01:00:00.000Z'),
    };
    auditModel.countDocuments.mockReturnValue(mockQuery(1));
    auditModel.find.mockReturnValue(mockFindQuery([audit]));

    const result = await service.listAudits({ page: 1, limit: 10 });

    expect(result.items[0]).not.toHaveProperty('actorId');

    expect(result).toEqual({
      items: [
        expect.objectContaining({
          id: 'audit-id',
          configId: CONFIG_ID,
          actorEmail: ACTOR_EMAIL,
        }),
      ],
      total: 1,
      page: 1,
      limit: 10,
      totalPages: 1,
    });
  });

  it.each([
    ['fee below zero', { platformFeePercent: -1 }],
    ['fee above 100', { platformFeePercent: 100.01 }],
    ['invalid fee value', { platformFeePercent: Number.NaN }],
    ['unsupported currency', { currency: 'USD' as PaymentConfigCurrency }],
    ['empty prices', { allowedPrices: [] }],
    ['missing free price', { allowedPrices: [99000] }],
    ['duplicate prices', { allowedPrices: [0, 99000, 99000] }],
    ['negative price', { allowedPrices: [0, -1] }],
    ['negative free course limit', { freeCourseLimit: -1 }],
    ['minimum withdrawal below policy', { minimumWithdrawalAmount: 999999 }],
    ['minimum withdrawal off step', { minimumWithdrawalAmount: 1050000 }],
    ['negative earning hold days', { earningHoldDays: -1 }],
    ['non-integer earning hold days', { earningHoldDays: 1.5 }],
  ])('rejects %s', async (_name, patch) => {
    configModel.findOne.mockReturnValue(mockQuery(createConfig()));
    const validDto: UpdatePaymentConfigDto = {
      platformFeePercent: 20,
      currency: 'VND',
      allowedPrices: [0, 99000],
      freeCourseLimit: 3,
      minimumWithdrawalAmount: 1000000,
      earningHoldDays: 7,
    };

    await expect(
      service.updateConfig(ACTOR_ID, ACTOR_EMAIL, { ...validDto, ...patch }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows configured course prices', async () => {
    configModel.findOne.mockReturnValue(mockQuery(createConfig()));

    await expect(
      service.assertCoursePriceAllowed(99000),
    ).resolves.toBeUndefined();
  });

  it('rejects disallowed course prices', async () => {
    configModel.findOne.mockReturnValue(mockQuery(createConfig()));

    await expect(
      service.assertCoursePriceAllowed(12345),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('calculates platform fee and instructor net', async () => {
    configModel.findOne.mockReturnValue(mockQuery(createConfig()));

    await expect(service.calculatePlatformFee(100000)).resolves.toBe(20000);
    await expect(service.calculateInstructorNet(100000)).resolves.toBe(80000);
  });

  it('returns the course pricing reference for instructor-facing pages', async () => {
    configModel.findOne.mockReturnValue(mockQuery(createConfig()));

    await expect(service.getCoursePricingReference()).resolves.toEqual({
      currency: 'VND',
      allowedPrices: [0, 99000, 199000, 299000, 499000, 799000, 999000],
    });
  });
});
