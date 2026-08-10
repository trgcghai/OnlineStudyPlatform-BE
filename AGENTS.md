# online-study-platform-be

NestJS 11 + TypeScript backend (CJS, `module: nodenext` in tsconfig — relative imports are extensionless). Package manager: **pnpm** (do not use npm/yarn).

## Architecture

- Config: `@nestjs/config` (`ConfigModule.forRoot({ isGlobal: true })` in `AppModule`). No validation schema — required values are read via `getOrThrow` (app fails on boot if missing). `.env` is gitignored; `.env.example` is the committed template (empty placeholders, no fallback values).
- PostgreSQL: `TypeOrmModule.forRootAsync` with `DB_*` vars, `synchronize: true` (dev).
- Redis: `src/redis/redis.module.ts` — global module providing `REDIS_CLIENT` (ioredis) from `REDIS_HOST`/`REDIS_PORT`; disconnects on module destroy (keeps jest e2e from hanging).
- `GET /health` (`AppController.getHealth` / `AppService.getHealth`): actuator-style payload — `application` + `postgresql` + `redis` are real checks; `mongodb`/`minio` are placeholders reporting `"developing"`. Docker-compose healthcheck for `be` curls `/health`.
- Env keys required at boot: `PORT`, `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`, `REDIS_HOST`, `REDIS_PORT`. Local dev connects to the compose infra via published ports (postgres = **5433**, not 5432 — a native PostgreSQL owns 5432 on this machine).

## Commands

- `pnpm install`
- `pnpm start:dev` — watch-mode dev server
- `pnpm build` — typechecks and emits to `dist/` via Nest CLI; `pnpm start:prod` runs `node dist/main`
- `pnpm test` — unit tests (jest, `rootDir: src`, `*.spec.ts` colocated with source)
- `pnpm test:e2e` — e2e tests (`test/jest-e2e.json`, `*.e2e-spec.ts` in `test/`); requires the compose postgres + redis running
- `pnpm lint` — eslint **with `--fix`** (mutates files); type-aware rules from `recommendedTypeChecked`
- No `typecheck` script — `pnpm build` (or `npx tsc --noEmit`) is the type check

## Conventions

- Prettier: `singleQuote: true`, `trailingComma: "all"` (`.prettierrc`); ESLint allows `no-explicit-any` but warns on `no-floating-promises`
- Scaffold code with `pnpm exec nest g <schematic> <name>` (sourceRoot `src`, build deletes `dist/` first)
- Unit tests colocated as `*.spec.ts` next to source; e2e specs go in `test/`; new features should get both
