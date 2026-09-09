# T2-11 Backend Payment Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build MongoDB-backed Admin payment configuration for platform fees, allowed prices, free-course limits, withdrawal minimums, startup defaults, audit history, and reusable backend access.

**Architecture:** Add a global `PaymentConfigModule` with Mongoose schemas, a controller-level Admin-only `ConfigController`, and an exported `ConfigService`. The service owns startup default initialization, runtime cache, validation, update/audit flow, and helper methods used by later course pricing, payment, and withdrawal tasks.

**Tech Stack:** NestJS 11, TypeScript, Mongoose, class-validator, class-transformer, Jest, pnpm.

---

## Skills By Task

- Use `superpowers:test-driven-development` for every task that adds or changes behavior.
- Use `nestjs-patterns` or `nestjs-best-practices` for module/controller/service/DTO implementation tasks.
- Use `systematic-debugging` if any test, build, validation, or runtime behavior fails unexpectedly.
- Use `verification-before-completion` before claiming a task or the full plan is complete.
- Use `requesting-code-review` after all implementation and verification pass.

If the skill loader fails with the known `Expand-Archive` PowerShell module issue, read the skill file directly and continue following it.

## File Map

- Create `src/modules/payment-config/payment-config.module.ts`: global module registration, Mongoose schemas, exported service.
- Create `src/modules/payment-config/schemas/config.schema.ts`: `PaymentConfig` Mongoose schema and document type.
- Create `src/modules/payment-config/schemas/config-audit.schema.ts`: `PaymentConfigAudit` Mongoose schema and document type.
- Create `src/modules/payment-config/dto/config.dto.ts`: update DTO, audit query DTO, response interfaces, constants.
- Create `src/modules/payment-config/config.service.ts`: default initialization, cache, validation, update/audit, helper methods.
- Create `src/modules/payment-config/config.controller.ts`: controller-level Admin-only endpoints.
- Create `src/modules/payment-config/config.service.spec.ts`: service unit tests with mocked Mongoose models.
- Create `src/modules/payment-config/config.controller.spec.ts`: controller metadata/delegation tests.
- Modify `src/app.module.ts`: import and wire `PaymentConfigModule`.

Do not commit during execution unless the user explicitly asks for commits.

---

### Task 1: Add DTO Contract And Constants

**Related skills:** `superpowers:test-driven-development`, `nestjs-patterns`

**Files:**
- Create: `src/modules/payment-config/dto/config.dto.ts`

- [ ] **Step 1: Create DTO file with validation contract**

Create `src/modules/payment-config/dto/config.dto.ts` with these contents:

```ts
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export const PAYMENT_CONFIG_SUPPORTED_CURRENCIES = ['VND'] as const;
export type PaymentConfigCurrency =
  (typeof PAYMENT_CONFIG_SUPPORTED_CURRENCIES)[number];

export const DEFAULT_PAYMENT_CONFIG = {
  platformFeePercent: 20,
  currency: 'VND' as PaymentConfigCurrency,
  allowedPrices: [0, 99000, 199000, 299000, 499000, 799000, 999000],
  freeCourseLimit: 3,
  minimumWithdrawalAmount: 100000,
  updatedById: null,
} as const;

export class UpdatePaymentConfigDto {
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  platformFeePercent!: number;

  @IsIn(PAYMENT_CONFIG_SUPPORTED_CURRENCIES)
  currency!: PaymentConfigCurrency;

  @IsArray()
  @ArrayNotEmpty()
  @IsInt({ each: true })
  @Min(0, { each: true })
  allowedPrices!: number[];

  @ValidateIf((dto: UpdatePaymentConfigDto) => dto.freeCourseLimit !== null)
  @IsOptional()
  @IsInt()
  @Min(0)
  freeCourseLimit!: number | null;

  @IsInt()
  @Min(1)
  minimumWithdrawalAmount!: number;
}

export class ListPaymentConfigAuditsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 10;
}

export interface PaymentConfigResponse {
  id: string;
  platformFeePercent: number;
  currency: PaymentConfigCurrency;
  allowedPrices: number[];
  freeCourseLimit: number | null;
  minimumWithdrawalAmount: number;
  updatedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentConfigSnapshot {
  platformFeePercent: number;
  currency: PaymentConfigCurrency;
  allowedPrices: number[];
  freeCourseLimit: number | null;
  minimumWithdrawalAmount: number;
  updatedById: string | null;
}

export interface PaymentConfigAuditResponse {
  id: string;
  configId: string;
  actorId: string;
  previousValue: PaymentConfigSnapshot;
  newValue: PaymentConfigSnapshot;
  changedFields: string[];
  createdAt: Date;
}

export interface PaymentConfigAuditListResult {
  items: PaymentConfigAuditResponse[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
```

- [ ] **Step 2: Review validation limits**

Confirm the DTO handles simple type validation, while business validation for finite percentage values, required `0`, duplicates, and sorted prices will live in `ConfigService`.

---

### Task 2: Add MongoDB Schemas

**Related skills:** `superpowers:test-driven-development`, `nestjs-patterns`

**Files:**
- Create: `src/modules/payment-config/schemas/config.schema.ts`
- Create: `src/modules/payment-config/schemas/config-audit.schema.ts`

- [ ] **Step 1: Create config schema**

Create `src/modules/payment-config/schemas/config.schema.ts`:

```ts
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
```

- [ ] **Step 2: Create config audit schema**

Create `src/modules/payment-config/schemas/config-audit.schema.ts`:

```ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import type { PaymentConfigSnapshot } from '../dto/config.dto';

export type PaymentConfigAuditDocument = HydratedDocument<PaymentConfigAudit>;

@Schema({ collection: 'payment_config_audits', timestamps: { createdAt: true, updatedAt: false } })
export class PaymentConfigAudit {
  @Prop({ required: true, type: String })
  configId!: string;

  @Prop({ required: true, type: String })
  actorId!: string;

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
```

- [ ] **Step 3: Run targeted TypeScript build check after schemas exist**

Run: `pnpm build`

Expected: build may fail because the module is not wired yet, but schema files should not have syntax/type errors. If the failure is unrelated to these files, continue and re-run after module wiring.

---

### Task 3: Write Service Tests First

**Related skills:** `superpowers:test-driven-development`, `nestjs-patterns`

**Files:**
- Create: `src/modules/payment-config/config.service.spec.ts`
- Later implementation: `src/modules/payment-config/config.service.ts`

- [ ] **Step 1: Create service test scaffold with mocked models**

Create `src/modules/payment-config/config.service.spec.ts` with tests for the full service contract. Use model doubles that expose `findOne`, `create`, `countDocuments`, and `find`.

Start with helper data:

```ts
import { BadRequestException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Model } from 'mongoose';
import { ConfigService } from './config.service';
import {
  DEFAULT_PAYMENT_CONFIG,
  UpdatePaymentConfigDto,
} from './dto/config.dto';
import { PaymentConfig } from './schemas/config.schema';
import { PaymentConfigAudit } from './schemas/config-audit.schema';

const CONFIG_ID = 'config-id';
const ACTOR_ID = 'admin-id';

function createConfig(overrides: Partial<PaymentConfig> = {}) {
  const config = {
    _id: { toString: () => CONFIG_ID },
    ...DEFAULT_PAYMENT_CONFIG,
    createdAt: new Date('2026-09-09T00:00:00.000Z'),
    updatedAt: new Date('2026-09-09T00:00:00.000Z'),
    save: jest.fn(),
    toObject() {
      return this;
    },
    ...overrides,
  };

  config.save.mockResolvedValue(config);

  return config;
}

function mockQuery<T>(value: T) {
  return { exec: jest.fn().mockResolvedValue(value) };
}
```

- [ ] **Step 2: Add default initialization tests**

Add tests:

```ts
it('creates default config on module init when no config exists', async () => {
  configModel.findOne.mockReturnValue(mockQuery(null) as never);
  configModel.create.mockResolvedValue(createConfig());

  await service.onModuleInit();

  expect(configModel.findOne).toHaveBeenCalledTimes(1);
  expect(configModel.create).toHaveBeenCalledWith(DEFAULT_PAYMENT_CONFIG);
});

it('does not create default config when config already exists', async () => {
  configModel.findOne.mockReturnValue(mockQuery(createConfig()) as never);

  await service.onModuleInit();

  expect(configModel.create).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Add get/update/audit tests**

Add these concrete tests:

```ts
it('returns active config from cache after initialization', async () => {
  const config = createConfig();
  configModel.findOne.mockReturnValue(mockQuery(config) as never);

  await service.onModuleInit();
  const result = await service.getActiveConfig();

  expect(result).toMatchObject({
    id: CONFIG_ID,
    platformFeePercent: DEFAULT_PAYMENT_CONFIG.platformFeePercent,
    currency: DEFAULT_PAYMENT_CONFIG.currency,
    allowedPrices: DEFAULT_PAYMENT_CONFIG.allowedPrices,
    freeCourseLimit: DEFAULT_PAYMENT_CONFIG.freeCourseLimit,
    minimumWithdrawalAmount: DEFAULT_PAYMENT_CONFIG.minimumWithdrawalAmount,
    updatedById: null,
  });
  expect(configModel.findOne).toHaveBeenCalledTimes(1);
});

it('updates config with normalized values and writes audit', async () => {
  const current = createConfig();
  const saved = createConfig({
    platformFeePercent: 15,
    allowedPrices: [0, 99000, 199000],
    freeCourseLimit: 5,
    minimumWithdrawalAmount: 200000,
    updatedById: ACTOR_ID,
  });
  current.save = jest.fn().mockResolvedValue(saved);
  configModel.findOne.mockReturnValue(mockQuery(current) as never);
  auditModel.create.mockResolvedValue({ _id: { toString: () => 'audit-id' } });

  const result = await service.updateConfig(ACTOR_ID, updateDto);

  expect(current.platformFeePercent).toBe(15);
  expect(current.allowedPrices).toEqual([0, 99000, 199000]);
  expect(current.updatedById).toBe(ACTOR_ID);
  expect(auditModel.create).toHaveBeenCalledWith(
    expect.objectContaining({
      configId: CONFIG_ID,
      actorId: ACTOR_ID,
      changedFields: expect.arrayContaining([
        'platformFeePercent',
        'allowedPrices',
        'freeCourseLimit',
        'minimumWithdrawalAmount',
      ]),
    }),
  );
  expect(result.platformFeePercent).toBe(15);
});

it('returns current config without audit for no-op update', async () => {
  const current = createConfig();
  configModel.findOne.mockReturnValue(mockQuery(current) as never);

  const result = await service.updateConfig(ACTOR_ID, {
    platformFeePercent: DEFAULT_PAYMENT_CONFIG.platformFeePercent,
    currency: 'VND',
    allowedPrices: [...DEFAULT_PAYMENT_CONFIG.allowedPrices],
    freeCourseLimit: DEFAULT_PAYMENT_CONFIG.freeCourseLimit,
    minimumWithdrawalAmount: DEFAULT_PAYMENT_CONFIG.minimumWithdrawalAmount,
  });

  expect(current.save).not.toHaveBeenCalled();
  expect(auditModel.create).not.toHaveBeenCalled();
  expect(result.id).toBe(CONFIG_ID);
});

it('lists audits with pagination', async () => {
  const audit = {
    _id: { toString: () => 'audit-id' },
    configId: CONFIG_ID,
    actorId: ACTOR_ID,
    previousValue: { ...DEFAULT_PAYMENT_CONFIG },
    newValue: { ...DEFAULT_PAYMENT_CONFIG, platformFeePercent: 15 },
    changedFields: ['platformFeePercent'],
    createdAt: new Date('2026-09-09T01:00:00.000Z'),
  };
  auditModel.countDocuments.mockReturnValue(mockQuery(1) as never);
  auditModel.find.mockReturnValue({
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([audit]),
  } as never);

  const result = await service.listAudits({ page: 1, limit: 10 });

  expect(result).toEqual({
    items: [expect.objectContaining({ id: 'audit-id', configId: CONFIG_ID })],
    total: 1,
    page: 1,
    limit: 10,
    totalPages: 1,
  });
});
```

Use this valid update payload:

```ts
const updateDto: UpdatePaymentConfigDto = {
  platformFeePercent: 15,
  currency: 'VND',
  allowedPrices: [199000, 0, 99000],
  freeCourseLimit: 5,
  minimumWithdrawalAmount: 200000,
};
```

Expected normalized saved fields:

```ts
{
  platformFeePercent: 15,
  currency: 'VND',
  allowedPrices: [0, 99000, 199000],
  freeCourseLimit: 5,
  minimumWithdrawalAmount: 200000,
  updatedById: ACTOR_ID,
}
```

- [ ] **Step 4: Add validation/helper tests**

Add tests that each expect `BadRequestException`:

```ts
it.each([
  ['fee below zero', { platformFeePercent: -1 }],
  ['fee above 100', { platformFeePercent: 100.01 }],
  ['invalid fee value', { platformFeePercent: Number.NaN }],
  ['unsupported currency', { currency: 'USD' }],
  ['empty prices', { allowedPrices: [] }],
  ['missing free price', { allowedPrices: [99000] }],
  ['duplicate prices', { allowedPrices: [0, 99000, 99000] }],
  ['negative price', { allowedPrices: [0, -1] }],
  ['negative free course limit', { freeCourseLimit: -1 }],
  ['zero minimum withdrawal', { minimumWithdrawalAmount: 0 }],
])('rejects %s', async (_name, patch) => {
  configModel.findOne.mockReturnValue(mockQuery(createConfig()) as never);
  const validDto: UpdatePaymentConfigDto = {
    platformFeePercent: 20,
    currency: 'VND',
    allowedPrices: [0, 99000],
    freeCourseLimit: 3,
    minimumWithdrawalAmount: 100000,
  };

  await expect(
    service.updateConfig(ACTOR_ID, { ...validDto, ...patch }),
  ).rejects.toBeInstanceOf(BadRequestException);
})
```

Also test:

```ts
it('allows configured course prices', async () => {
  configModel.findOne.mockReturnValue(mockQuery(createConfig()) as never);
  await expect(service.assertCoursePriceAllowed(99000)).resolves.toBeUndefined();
});

it('rejects disallowed course prices', async () => {
  configModel.findOne.mockReturnValue(mockQuery(createConfig()) as never);
  await expect(service.assertCoursePriceAllowed(12345)).rejects.toBeInstanceOf(
    BadRequestException,
  );
});

it('calculates platform fee and instructor net', async () => {
  configModel.findOne.mockReturnValue(mockQuery(createConfig()) as never);
  await expect(service.calculatePlatformFee(100000)).resolves.toBe(20000);
  await expect(service.calculateInstructorNet(100000)).resolves.toBe(80000);
});
```

- [ ] **Step 5: Run failing service tests**

Run: `pnpm test -- config.service`

Expected: FAIL because `config.service.ts` does not exist yet.

---

### Task 4: Implement ConfigService

**Related skills:** `superpowers:test-driven-development`, `nestjs-patterns`, `systematic-debugging` if tests fail unexpectedly

**Files:**
- Create: `src/modules/payment-config/config.service.ts`
- Test: `src/modules/payment-config/config.service.spec.ts`

- [ ] **Step 1: Create service with injected Mongoose models**

Create `src/modules/payment-config/config.service.ts` with:

```ts
import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  DEFAULT_PAYMENT_CONFIG,
  ListPaymentConfigAuditsQueryDto,
  PaymentConfigAuditListResult,
  PaymentConfigAuditResponse,
  PaymentConfigResponse,
  PaymentConfigSnapshot,
  UpdatePaymentConfigDto,
} from './dto/config.dto';
import { PaymentConfig, PaymentConfigDocument } from './schemas/config.schema';
import {
  PaymentConfigAudit,
  PaymentConfigAuditDocument,
} from './schemas/config-audit.schema';

@Injectable()
export class ConfigService implements OnModuleInit {
  private cachedConfig: PaymentConfigResponse | null = null;

  constructor(
    @InjectModel(PaymentConfig.name)
    private readonly configModel: Model<PaymentConfigDocument>,
    @InjectModel(PaymentConfigAudit.name)
    private readonly auditModel: Model<PaymentConfigAuditDocument>,
  ) {}
}
```

- [ ] **Step 2: Implement startup initialization and active config reads**

Add:

```ts
async onModuleInit(): Promise<void> {
  await this.ensureDefaultConfig();
}

async ensureDefaultConfig(): Promise<void> {
  const existing = await this.configModel.findOne().exec();
  if (existing) {
    this.cachedConfig = this.toConfigResponse(existing);
    return;
  }

  const created = await this.configModel.create(DEFAULT_PAYMENT_CONFIG);
  this.cachedConfig = this.toConfigResponse(created);
}

async getActiveConfig(): Promise<PaymentConfigResponse> {
  if (this.cachedConfig) return this.cachedConfig;

  await this.ensureDefaultConfig();

  if (!this.cachedConfig) {
    throw new BadRequestException('Payment configuration is not available');
  }

  return this.cachedConfig;
}
```

If the mocked tests do not use `.exec()`, update tests or implementation consistently with the backend's Mongoose mock style.

- [ ] **Step 3: Implement validation and normalization helpers**

Add private helpers:

```ts
private normalizeUpdateDto(dto: UpdatePaymentConfigDto): PaymentConfigSnapshot {
  if (
    !Number.isFinite(dto.platformFeePercent) ||
    dto.platformFeePercent < 0 ||
    dto.platformFeePercent > 100
  ) {
    throw new BadRequestException('Platform fee percent must be between 0 and 100');
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
      throw new BadRequestException('Allowed prices must be non-negative integers');
    }
  }

  if (
    dto.freeCourseLimit !== null &&
    (!Number.isInteger(dto.freeCourseLimit) || dto.freeCourseLimit < 0)
  ) {
    throw new BadRequestException('Free course limit must be null or a non-negative integer');
  }

  if (
    !Number.isInteger(dto.minimumWithdrawalAmount) ||
    dto.minimumWithdrawalAmount <= 0
  ) {
    throw new BadRequestException('Minimum withdrawal amount must be a positive integer');
  }

  return {
    platformFeePercent: dto.platformFeePercent,
    currency: 'VND',
    allowedPrices: [...dto.allowedPrices].sort((a, b) => a - b),
    freeCourseLimit: dto.freeCourseLimit,
    minimumWithdrawalAmount: dto.minimumWithdrawalAmount,
    updatedById: null,
  };
}
```

- [ ] **Step 4: Implement update and audit flow**

Add `updateConfig`, `getChangedFields`, `toSnapshot`, and `toConfigResponse` so the update flow matches the spec:

```ts
async updateConfig(
  actorId: string,
  dto: UpdatePaymentConfigDto,
): Promise<PaymentConfigResponse> {
  await this.ensureDefaultConfig();
  const current = await this.configModel.findOne().exec();

  if (!current) {
    throw new BadRequestException('Payment configuration is not available');
  }

  const previousValue = this.toSnapshot(current);
  const normalized = this.normalizeUpdateDto(dto);
  const newValue = { ...normalized, updatedById: actorId };
  const changedFields = this.getChangedFields(previousValue, newValue);

  if (changedFields.length === 0) {
    const response = this.toConfigResponse(current);
    this.cachedConfig = response;
    return response;
  }

  current.platformFeePercent = newValue.platformFeePercent;
  current.currency = newValue.currency;
  current.allowedPrices = newValue.allowedPrices;
  current.freeCourseLimit = newValue.freeCourseLimit;
  current.minimumWithdrawalAmount = newValue.minimumWithdrawalAmount;
  current.updatedById = actorId;

  const saved = await current.save();
  await this.auditModel.create({
    configId: saved._id.toString(),
    actorId,
    previousValue,
    newValue: this.toSnapshot(saved),
    changedFields,
  });

  const response = this.toConfigResponse(saved);
  this.cachedConfig = response;
  return response;
}
```

When comparing fields, compare arrays by value and include only business configuration fields. Do not treat `updatedById` alone as a configuration change.

- [ ] **Step 5: Implement audit listing and helper methods**

Add:

```ts
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
```

- [ ] **Step 6: Run service tests until green**

Run: `pnpm test -- config.service`

Expected: PASS.

If tests fail unexpectedly, invoke/read `systematic-debugging` before changing implementation.

---

### Task 5: Add Controller Tests First

**Related skills:** `superpowers:test-driven-development`, `nestjs-patterns`

**Files:**
- Create: `src/modules/payment-config/config.controller.spec.ts`
- Later implementation: `src/modules/payment-config/config.controller.ts`

- [ ] **Step 1: Create controller tests**

Create `src/modules/payment-config/config.controller.spec.ts` with tests that inspect class metadata and delegation:

```ts
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../common/constants/auth.constant';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';
import { ConfigController } from './config.controller';
import { ConfigService } from './config.service';

describe('ConfigController', () => {
  let controller: ConfigController;
  let service: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    service = {
      getActiveConfig: jest.fn(),
      updateConfig: jest.fn(),
      listAudits: jest.fn(),
    } as unknown as jest.Mocked<ConfigService>;

    const moduleRef = await Test.createTestingModule({
      controllers: [ConfigController],
      providers: [{ provide: ConfigService, useValue: service }, Reflector],
    }).compile();

    controller = moduleRef.get(ConfigController);
  });
});
```

- [ ] **Step 2: Add metadata tests**

Add:

```ts
it('uses controller-level auth and role guards', () => {
  const guards = Reflect.getMetadata(GUARDS_METADATA, ConfigController) as unknown[];
  expect(guards).toContain(JwtAuthGuard);
  expect(guards).toContain(RolesGuard);
});

it('requires Admin role at controller level', () => {
  expect(Reflect.getMetadata(ROLES_KEY, ConfigController)).toEqual([
    UserRole.ADMIN,
  ]);
});
```

- [ ] **Step 3: Add delegation tests**

Add:

```ts
it('gets active config', async () => {
  const response = { id: 'config-id' } as Awaited<ReturnType<ConfigService['getActiveConfig']>>;
  service.getActiveConfig.mockResolvedValue(response);
  await expect(controller.getConfig()).resolves.toBe(response);
});

it('updates config with current admin id', async () => {
  const dto = {
    platformFeePercent: 15,
    currency: 'VND',
    allowedPrices: [0, 99000],
    freeCourseLimit: 3,
    minimumWithdrawalAmount: 100000,
  };
  const response = { id: 'config-id' } as Awaited<ReturnType<ConfigService['updateConfig']>>;
  service.updateConfig.mockResolvedValue(response);
  await expect(controller.updateConfig('admin-id', dto)).resolves.toBe(response);
  expect(service.updateConfig).toHaveBeenCalledWith('admin-id', dto);
});

it('lists audits', async () => {
  const query = { page: 1, limit: 10 };
  const response = { items: [], total: 0, page: 1, limit: 10, totalPages: 1 };
  service.listAudits.mockResolvedValue(response);
  await expect(controller.listAudits(query)).resolves.toBe(response);
});
```

- [ ] **Step 4: Run failing controller tests**

Run: `pnpm test -- config.controller`

Expected: FAIL because `config.controller.ts` does not exist yet.

---

### Task 6: Implement ConfigController

**Related skills:** `superpowers:test-driven-development`, `nestjs-patterns`

**Files:**
- Create: `src/modules/payment-config/config.controller.ts`
- Test: `src/modules/payment-config/config.controller.spec.ts`

- [ ] **Step 1: Create controller**

Create `src/modules/payment-config/config.controller.ts`:

```ts
import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';
import { ConfigService } from './config.service';
import {
  ListPaymentConfigAuditsQueryDto,
  UpdatePaymentConfigDto,
} from './dto/config.dto';

@Controller('payment/config')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  @Get()
  getConfig() {
    return this.configService.getActiveConfig();
  }

  @Put()
  updateConfig(
    @CurrentUser('id') actorId: string,
    @Body() dto: UpdatePaymentConfigDto,
  ) {
    return this.configService.updateConfig(actorId, dto);
  }

  @Get('audits')
  listAudits(@Query() query: ListPaymentConfigAuditsQueryDto) {
    return this.configService.listAudits(query);
  }
}
```

- [ ] **Step 2: Run controller tests until green**

Run: `pnpm test -- config.controller`

Expected: PASS.

---

### Task 7: Add PaymentConfigModule And Wire AppModule

**Related skills:** `nestjs-patterns`, `superpowers:test-driven-development`

**Files:**
- Create: `src/modules/payment-config/payment-config.module.ts`
- Modify: `src/app.module.ts`
- Test: `src/modules/payment-config/config.service.spec.ts`, `src/modules/payment-config/config.controller.spec.ts`

- [ ] **Step 1: Create global module**

Create `src/modules/payment-config/payment-config.module.ts`:

```ts
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
```

- [ ] **Step 2: Wire AppModule**

Modify `src/app.module.ts`:

```ts
import { PaymentConfigModule } from './modules/payment-config/payment-config.module';
```

Add `PaymentConfigModule` to the `imports` array after `QuizzesModule` and before `SeedsModule`:

```ts
QuizzesModule,
PaymentConfigModule,
SeedsModule,
```

- [ ] **Step 3: Run focused tests**

Run: `pnpm test -- config`

Expected: PASS.

---

### Task 8: Harden Service Implementation Against Mongoose Mock/Runtime Details

**Related skills:** `systematic-debugging`, `nestjs-patterns`, `superpowers:test-driven-development`

**Files:**
- Modify: `src/modules/payment-config/config.service.ts`
- Modify if needed: `src/modules/payment-config/config.service.spec.ts`

- [ ] **Step 1: Check Mongoose query style consistency**

If mocks fail because `.exec()` is missing, either:

```ts
configModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(config) } as never);
```

or remove `.exec()` from implementation only if existing backend Mongoose code uses direct awaited queries. Prefer `.exec()` for explicit Mongoose query execution.

- [ ] **Step 2: Ensure document save test uses realistic document double**

Saved config document in tests must include:

```ts
save: jest.fn().mockResolvedValue(savedConfig)
```

The current document object must allow property assignment before `save()`.

- [ ] **Step 3: Ensure ID conversion is safe**

Use helper:

```ts
private getDocumentId(document: { _id?: unknown; id?: string }): string {
  if (document.id) return document.id;
  return String(document._id);
}
```

Use this helper for config and audit responses.

- [ ] **Step 4: Re-run focused tests**

Run: `pnpm test -- config`

Expected: PASS.

---

### Task 9: Full Backend Verification

**Related skills:** `verification-before-completion`, `systematic-debugging` if any verification fails

**Files:**
- No code changes unless verification exposes a real issue.

- [ ] **Step 1: Run focused tests**

Run: `pnpm test -- config`

Expected: all payment config service/controller tests pass.

- [ ] **Step 2: Run backend build**

Run: `pnpm build`

Expected: Nest build completes successfully.

- [ ] **Step 3: Inspect git diff**

Run: `git diff --stat`

Expected files are limited to:

```txt
src/app.module.ts
src/modules/payment-config/config.controller.ts
src/modules/payment-config/config.controller.spec.ts
src/modules/payment-config/config.service.ts
src/modules/payment-config/config.service.spec.ts
src/modules/payment-config/dto/config.dto.ts
src/modules/payment-config/payment-config.module.ts
src/modules/payment-config/schemas/config-audit.schema.ts
src/modules/payment-config/schemas/config.schema.ts
```

- [ ] **Step 4: Confirm no unintended files**

Run: `git status --short`

Expected: only intended T2-11 backend implementation files are modified/untracked.

---

### Task 10: Code Review Readiness

**Related skills:** `requesting-code-review`, `verification-before-completion`

**Files:**
- No code changes unless review finds issues.

- [ ] **Step 1: Request focused review**

Ask review to check:

- Startup initialization creates exactly one config when missing.
- Controller-level guards and role metadata are correct.
- Non-admin users cannot access endpoints.
- Validation rejects invalid fee, currency, price list, free-course limit, and withdrawal minimum.
- No-op update does not write audit.
- Real update writes accurate audit with actor and changed fields.
- Exported `ConfigService` is safe for other modules to inject later.

- [ ] **Step 2: Fix review findings if any**

If findings are valid, apply the smallest correct changes and re-run:

```bash
pnpm test -- config
pnpm build
```

- [ ] **Step 3: Final completion statement**

Only after verification passes, report:

- files changed
- tests/build run
- any residual risks, such as no DB-backed e2e test for Mongo startup initialization
