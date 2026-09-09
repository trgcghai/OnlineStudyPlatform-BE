# T2-11 Backend Design: Payment Configuration

## Context

T2-11 adds Admin-managed monetization configuration for paid course features. This backend work must provide the central rules that later tasks consume:

- T2-12 uses the allowed price list and free-course limit when instructors create or update courses.
- T2-13 uses currency and configured prices when creating payment transactions.
- T2-14 uses platform fee and minimum withdrawal amount when calculating instructor earnings and withdrawal eligibility.

The configuration should be stored in MongoDB, initialized on server startup, and exposed to other backend services through a global module-level service.

## Decisions

- Use a dedicated `PaymentConfigModule`.
- Store config and audit history in MongoDB with Mongoose schemas.
- Use `ConfigController`, `ConfigService`, and `dto/config.dto.ts` naming.
- Use schema files named `schemas/config.schema.ts` and `schemas/config-audit.schema.ts`.
- Make `PaymentConfigModule` global and export `ConfigService` so other services can inject it.
- Initialize the default config at server startup if MongoDB does not already contain one.
- Apply admin-only guards and roles at controller level.
- Expose a paginated audit API in T2-11.
- Apply `freeCourseLimit` to all instructors immediately because there is no instructor verification state yet.

## Module Structure

Add:

```txt
src/modules/payment-config/
  payment-config.module.ts
  config.controller.ts
  config.service.ts
  dto/
    config.dto.ts
  schemas/
    config.schema.ts
    config-audit.schema.ts
  config.controller.spec.ts
  config.service.spec.ts
```

Wire `PaymentConfigModule` into `src/app.module.ts`.

## Module Contract

`PaymentConfigModule` should be global:

```ts
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

Other services should depend on `ConfigService` methods rather than reading MongoDB directly.

## MongoDB Schemas

### `PaymentConfig`

Collection: `payment_configs`

Fields:

- `singletonKey: 'active'`, internal unique key not exposed in API responses
- `platformFeePercent: number`
- `currency: 'VND'`
- `allowedPrices: number[]`
- `freeCourseLimit: number | null`
- `minimumWithdrawalAmount: number`
- `updatedById: string | null`
- `createdAt: Date`
- `updatedAt: Date`

Use timestamps from Mongoose. Store `platformFeePercent` as a number because Admin config uses percentage values directly and later fee calculations need numeric arithmetic. Use `singletonKey` to keep startup initialization safe if multiple backend instances start against an empty MongoDB database.

### `PaymentConfigAudit`

Collection: `payment_config_audits`

Fields:

- `configId: string`
- `actorId: string`
- `previousValue: Record<string, unknown>`
- `newValue: Record<string, unknown>`
- `changedFields: string[]`
- `createdAt: Date`

Use this audit document only for Admin updates that actually change configuration values. Do not create an audit row for initial default config initialization.

## Default Configuration

On server startup, `ConfigService` checks whether a config document exists.

- If one exists, do nothing.
- If none exists, create this default config:

```ts
{
  platformFeePercent: 20,
  currency: 'VND',
  allowedPrices: [0, 99000, 199000, 299000, 499000, 799000, 999000],
  freeCourseLimit: 3,
  minimumWithdrawalAmount: 100000,
  updatedById: null,
}
```

`freeCourseLimit = 3` means every instructor can have at most three free courses by default.

Implementation should be deterministic and safe to run repeatedly. `GET /payment/config` may call the same ensure method defensively, but the main initialization happens during module startup.

## Runtime Access

`ConfigService` should implement startup initialization and expose reusable methods:

```ts
onModuleInit(): Promise<void>
ensureDefaultConfig(): Promise<void>
getActiveConfig(): Promise<PaymentConfigResponse>
updateConfig(actorId: string, dto: UpdatePaymentConfigDto): Promise<PaymentConfigResponse>
listAudits(query: ListPaymentConfigAuditsQueryDto): Promise<PaymentConfigAuditListResult>
assertCoursePriceAllowed(price: number): Promise<void>
getFreeCourseLimit(): Promise<number | null>
calculatePlatformFee(amount: number): Promise<number>
calculateInstructorNet(amount: number): Promise<number>
```

The service may keep an in-memory cached config because config is read often and updated rarely.

Cache behavior:

- Startup loads or creates config, then stores it in memory.
- `getActiveConfig()` returns the cached value when available.
- `updateConfig()` persists MongoDB changes, writes audit, then refreshes the cache.
- If cache is empty, load from MongoDB and ensure default config if needed.

## API Design

Controller route:

```ts
@Controller('payment/config')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class ConfigController {}
```

Endpoints:

```http
GET /payment/config
PUT /payment/config
GET /payment/config/audits?page=1&limit=10
```

All endpoints are Admin-only through controller-level guards and role metadata.

## DTOs

`UpdatePaymentConfigDto` fields:

- `platformFeePercent: number`
- `currency: 'VND'`
- `allowedPrices: number[]`
- `freeCourseLimit: number | null`
- `minimumWithdrawalAmount: number`

`ListPaymentConfigAuditsQueryDto` fields:

- `page: number = 1`
- `limit: number = 10`, max `100`

Store `platformFeePercent` as a number without conversion.

## Validation Rules

Reject update payloads when:

- `platformFeePercent` is missing, not a number, below `0`, or above `100`.
- `currency` is missing or not `VND`.
- `allowedPrices` is empty.
- `allowedPrices` does not include `0`.
- Any allowed price is negative.
- Any allowed price is not an integer.
- Allowed prices contain duplicates.
- `freeCourseLimit` is not `null` and is negative or not an integer.
- `minimumWithdrawalAmount` is missing, not an integer, or less than or equal to `0`.

Sort allowed prices only after validation. Duplicates should be rejected, not silently fixed.

## Update And Audit Flow

`PUT /payment/config` should:

1. Load the active config, ensuring the default exists if needed.
2. Validate and normalize incoming values.
3. Compare the normalized payload to the current config.
4. If there are no business configuration changes, return the current config without updating `updatedById` or creating an audit row.
5. Save the updated config with `updatedById = actorId`.
6. Create one audit document with `configId`, `actorId`, `previousValue`, `newValue`, `changedFields`, and `createdAt`.
7. Refresh the in-memory cached config.
8. Return the updated config.

## Response Shapes

Configuration response:

```ts
interface PaymentConfigResponse {
  id: string;
  platformFeePercent: number;
  currency: 'VND';
  allowedPrices: number[];
  freeCourseLimit: number | null;
  minimumWithdrawalAmount: number;
  updatedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}
```

Audit response:

```ts
interface PaymentConfigAuditResponse {
  id: string;
  configId: string;
  actorId: string;
  previousValue: Record<string, unknown>;
  newValue: Record<string, unknown>;
  changedFields: string[];
  createdAt: Date;
}

interface PaymentConfigAuditListResult {
  items: PaymentConfigAuditResponse[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
```

The global response interceptor wraps these as the existing `{ success, statusCode, data, timestamp }` shape.

## Integration Points For Later Tasks

T2-12 course pricing should inject `ConfigService` and call `assertCoursePriceAllowed(price)` on course create/update. For free courses, it should also use `getFreeCourseLimit()` and count the instructor's current free courses.

T2-13 payment creation should use `getActiveConfig()` to verify currency and amount before creating a payment transaction.

T2-14 earnings and withdrawal should call `calculatePlatformFee(amount)`, `calculateInstructorNet(amount)`, and read `minimumWithdrawalAmount` from `getActiveConfig()`.

## Error Handling

Use Nest exceptions consistent with the codebase:

- `BadRequestException` for invalid configuration payloads.
- `ForbiddenException` should be handled by guards/roles for non-admin users.
- `InternalServerErrorException` only for unexpected persistence failures.

Validation errors should be specific enough for FE field mapping, for example `Allowed prices must include 0` or `Platform fee percent must be between 0 and 100`.

## Test Plan

Use unit tests with mocked Mongoose models.

Service tests:

- Creates default config on module init when MongoDB has no config.
- Does not create default config when one already exists.
- Gets active config from cache after initialization.
- Updates config with normalized values.
- No-op update returns current config without audit creation.
- Real update creates one audit document with changed fields.
- Audit listing returns paginated result.
- Rejects invalid fee, currency, allowed prices, free-course limit, and minimum withdrawal amount.
- Calculates platform fee and instructor net from current config.
- Rejects disallowed course price through `assertCoursePriceAllowed`.

Controller tests:

- Controller has controller-level `JwtAuthGuard`, `RolesGuard`, and `Admin` role metadata.
- `GET /payment/config` delegates to `ConfigService.getActiveConfig()`.
- `PUT /payment/config` passes `CurrentUser('id')` to `ConfigService.updateConfig()`.
- `GET /payment/config/audits` delegates to `ConfigService.listAudits()`.

Verification commands:

```bash
pnpm test -- config
pnpm build
```
