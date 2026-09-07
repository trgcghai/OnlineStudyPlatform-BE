# online-study-platform-be

NestJS 11 + TypeScript backend. Use **pnpm** only; Docker builds run Node 22 with Corepack and `pnpm install --frozen-lockfile`.

## Commands

- `pnpm install` installs from `pnpm-lock.yaml`; do not use npm/yarn.
- `pnpm start:dev` runs Nest watch mode; `pnpm start:prod` expects `pnpm build` first and runs `node dist/main`.
- `pnpm build` is the typecheck/emission path (`nest build`, with `deleteOutDir` enabled). There is no separate `typecheck` script.
- `pnpm lint` runs ESLint with `--fix`, so it can mutate files.
- `pnpm test` runs unit tests from `src/**/*.spec.ts`; focus with Jest args, e.g. `pnpm test -- auth.service`.
- `pnpm test:e2e` runs `test/*.e2e-spec.ts` with `test/setup-e2e-env.ts`; the setup only supplies JWT defaults, so Postgres, Redis, MongoDB, and MinIO must still be reachable.
- `.husky/pre-commit` runs `pnpm test` before `pnpm lint-staged`.

## Runtime Wiring

- Entry points: `src/main.ts` bootstraps `AppModule`; `src/app.module.ts` wires global config, Redis, MinIO, MongoDB, TypeORM, scheduling, users, auth, courses, lessons, enrollments, learning, dashboard, notifications, quizzes, and seeds.
- `ConfigModule.forRoot({ isGlobal: true })` has no validation schema; required env is enforced by `getOrThrow`, so missing values fail at boot or first use.
- Required env keys are listed in `.env.example`: `PORT`, `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`, `REDIS_HOST`, `REDIS_PORT`, `MONGODB_URI`, `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`.
- Local env hints from `.env.example`: Postgres host port `5433`, MongoDB URI `mongodb://localhost:27017/kltn`, MinIO endpoint `http://localhost:9000`.
- PostgreSQL uses TypeORM with `autoLoadEntities: true` and `synchronize: true`; there are no migrations in this repo.
- `SeedsModule` runs on application bootstrap and creates sample users/courses/lessons/quizzes; booting the app can mutate the configured Postgres DB.
- Redis is a global `REDIS_CLIENT` from `src/modules/redis/redis.module.ts` and calls `quit()` on module destroy.
- MinIO is a global `MINIO_CLIENT`; `FileModule.onModuleInit()` creates `MINIO_BUCKET` if missing and applies a public read policy. `MINIO_ENDPOINT` must be a full URL.
- Auth stores refresh sessions and access-token blacklist entries in Redis; JWT TTL strings must match `^\d+[smhd]$`.

## API/Test Gotchas

- `src/main.ts` applies `cookieParser`, CORS, and `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })`; e2e specs that instantiate `AppModule` must add these themselves when needed.
- Global responses are wrapped by `ResponseInterceptor` as `{ success, statusCode, data, timestamp }`; `StreamableFile` and 204 responses bypass wrapping.
- Global errors are shaped by `HttpExceptionFilter` as `{ success: false, statusCode, data: null, error, timestamp }`.
- `GET /health` performs real Postgres, Redis, MongoDB, and MinIO checks with 3s per-component timeouts and returns 503 if any infra component is down.
- Unit tests are colocated as `*.spec.ts` under `src`; e2e tests live under `test/` and often create/delete real database rows and Redis auth keys.

## Conventions

- `tsconfig.json` uses `module`/`moduleResolution: "nodenext"`, while source imports remain extensionless Nest/CommonJS-style imports.
- Prettier is `singleQuote: true`, `trailingComma: "all"`; ESLint also enforces Prettier with `endOfLine: "auto"`.
- Scaffold Nest code with `pnpm exec nest g <schematic> <name>` so `sourceRoot: "src"` is honored.
