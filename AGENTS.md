# online-study-platform-be

NestJS 11 + TypeScript backend. Use **pnpm** only; Docker uses Node 22, Corepack, and `pnpm install --frozen-lockfile`.

## Commands

- `pnpm install` installs from `pnpm-lock.yaml`; do not use npm/yarn.
- `pnpm start:dev` runs Nest watch mode; `pnpm start:prod` expects `pnpm build` first and runs `node dist/main`.
- `pnpm build` is the typecheck/emission path (`nest build`, `deleteOutDir` enabled). There is no separate typecheck script.
- `pnpm lint` runs ESLint with `--fix`, so it can mutate files. `.husky/pre-commit` runs `pnpm test` before `pnpm lint-staged`.
- `pnpm test` runs unit tests from `src/**/*.spec.ts`; focus with Jest args, e.g. `pnpm test -- auth.service` or `pnpm test --runInBand -- payments.service`.
- `pnpm test:e2e` runs `test/*.e2e-spec.ts` with `test/setup-e2e-env.ts`; setup only supplies JWT defaults, so real Postgres, Redis, MongoDB, and MinIO must still be reachable.
- TypeORM CLI loads `.env` through `src/database/data-source.ts`: `pnpm migration:run`, `pnpm migration:revert`, `pnpm migration:show`.

## Runtime Wiring

- Entry points: `src/main.ts` bootstraps `AppModule`; `src/app.module.ts` wires global config, BullMQ/Redis, MinIO/S3 clients, MongoDB, TypeORM, throttling, scheduling, feature modules, and seeds.
- `ConfigModule.forRoot({ isGlobal: true })` has no validation schema; most required env fails at boot or first use via `getOrThrow`. `.env.example` is the source of env names and local hints.
- Local env hints from `.env.example`: Postgres host port `5433`, Redis host port `6379`, MongoDB `mongodb://localhost:27017/kltn`, MinIO `http://localhost:9000`.
- App-time PostgreSQL uses `autoLoadEntities: true`; `synchronize` is true outside production unless `DB_SYNCHRONIZE` overrides it. Migration CLI is separate with `synchronize: false` and explicit entities in `src/database/data-source.ts`.
- `SeedsModule` runs on application bootstrap: sample users can be created in Postgres, and `BankSeed` fetches VietQR banks into MongoDB when reachable. Courses, lessons, quizzes, and questions are not auto-seeded.
- Redis is both a global `REDIS_CLIENT` and the BullMQ backend. Auth stores refresh sessions, OTPs, reset grants, and token blacklist entries in Redis; JWT TTL strings must match `^\d+[smhd]$`.
- BullMQ uses the shared Redis connection for notifications, lesson imports, course asset cleanup, AI workloads, and certificate issuance.
- `FileModule.onModuleInit()` creates `MINIO_BUCKET` if missing and applies public-read policy. `MINIO_ENDPOINT` must be a full URL; `MINIO_PUBLIC_ENDPOINT` is used for browser-reachable S3 signing when set.
- Certificates use a private bucket (`CERTIFICATES_BUCKET` or `${MINIO_BUCKET}-certificates`) and must not share `MINIO_BUCKET`; see `docs/certificates.md` before changing certificate storage or issuance.
- Docker installs `ffmpeg`/`ffprobe`. Direct host runs need these on PATH or `FFMPEG_PATH`/`FFPROBE_PATH` for AI summary audio extraction and lesson video duration import.

## API/Test Gotchas

- `src/main.ts` enables raw body, `cookieParser`, CORS, and `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })`; e2e specs that instantiate `AppModule` must add equivalent app setup when asserting those behaviors.
- Global success responses are wrapped as `{ success, statusCode, data, timestamp }`; `StreamableFile` and 204 responses bypass wrapping. Global errors are `{ success: false, statusCode, data: null, error, timestamp }`.
- `GET /health` performs real Postgres, Redis, MongoDB, and MinIO checks with 3s per-component timeouts and returns 503 if any infra component is down.
- SePay webhook HMAC verification reads `request.rawBody`; keep `NestFactory.create(AppModule, { rawBody: true })` if touching bootstrap or webhook tests.
- Unit tests are colocated under `src`; e2e tests under `test/` often create/delete real database rows, Redis keys, queues, and MinIO buckets.

## Conventions

- `tsconfig.json` uses `module`/`moduleResolution: "nodenext"`, while source imports remain extensionless Nest/CommonJS-style imports.
- Prettier uses `singleQuote: true`, `trailingComma: "all"`; ESLint also enforces Prettier with `endOfLine: "auto"`.
- Scaffold Nest code with `pnpm exec nest g <schematic> <name>` so `sourceRoot: "src"` is honored.
