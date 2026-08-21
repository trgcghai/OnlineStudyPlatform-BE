# online-study-platform-be

NestJS 11 + TypeScript backend. Use **pnpm** only; the Dockerfile runs Node 22 with Corepack and `pnpm install --frozen-lockfile`.

## Commands

- `pnpm install` installs from `pnpm-lock.yaml`; do not use npm/yarn.
- `pnpm start:dev` runs the Nest watch server; `pnpm start:prod` expects a prior `pnpm build` and runs `node dist/main`.
- `pnpm build` is the typecheck/emission path (`nest build`, deletes `dist/` via `nest-cli.json`). There is no `typecheck` script.
- `pnpm lint` runs ESLint with `--fix`, so it can mutate files.
- `pnpm test` runs unit tests from `src/**/*.spec.ts`; focus with Jest args, e.g. `pnpm test auth.service`.
- `pnpm test:e2e` runs `test/*.e2e-spec.ts` with `test/setup-e2e-env.ts`; it still needs reachable Postgres, Redis, MongoDB, and MinIO.

## Runtime Wiring

- Entry points: `src/main.ts` bootstraps `AppModule`; `src/app.module.ts` wires global config, Redis, MinIO, MongoDB, TypeORM, users, and auth.
- `ConfigModule.forRoot({ isGlobal: true })` has no validation schema; required config is enforced by `getOrThrow`, so missing env fails at boot or first use.
- Required env keys in `.env.example`: `PORT`, `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`, `REDIS_HOST`, `REDIS_PORT`, `MONGODB_URI`, `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`.
- PostgreSQL uses TypeORM with `autoLoadEntities: true` and `synchronize: true`; there are no migrations in this repo.
- Redis is a global `REDIS_CLIENT` from `src/modules/redis/redis.module.ts`; it calls `quit()` on module destroy so tests can exit.
- MinIO is a global `MINIO_CLIENT`; `FileModule.onModuleInit()` creates `MINIO_BUCKET` if needed and applies a public read policy. `MINIO_ENDPOINT` must be a full URL such as `http://localhost:9000`.
- Auth stores refresh sessions and access-token blacklist entries in Redis; JWT TTL strings must match `^\d+[smhd]$`.

## API/Test Gotchas

- Global `ValidationPipe` uses `whitelist`, `forbidNonWhitelisted`, and `transform`; DTO tests should account for stripped/forbidden extra fields.
- Global responses are wrapped by `ResponseInterceptor` as `{ success, statusCode, data, timestamp }`; `StreamableFile` and 204 responses bypass wrapping.
- Global errors are shaped by `HttpExceptionFilter` as `{ success: false, statusCode, data: null, error, timestamp }`.
- `GET /health` performs real Postgres, Redis, MongoDB, and MinIO checks and returns 503 if any are down. The e2e spec asserts wrapped component statuses for all four services.

## Conventions

- `tsconfig.json` uses `module`/`moduleResolution: "nodenext"`, but imports in source are extensionless CommonJS-style Nest imports.
- Prettier is `singleQuote: true`, `trailingComma: "all"`; ESLint also enforces Prettier with `endOfLine: "auto"`.
- Unit tests are colocated as `*.spec.ts` under `src`; e2e tests live under `test/`.
- Scaffold Nest code with `pnpm exec nest g <schematic> <name>` so `sourceRoot: "src"` is honored.
