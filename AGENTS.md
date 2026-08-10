# online-study-platform-be

NestJS 11 + TypeScript backend (CJS, `module: nodenext` in tsconfig — relative imports are extensionless). Package manager: **pnpm** (do not use npm/yarn). Node 22 (per Dockerfile).

## Repo context

This repo is a **git submodule** of the parent workspace `F:\Cntt\KLTN` (which also contains `onlinestudyplatform-fe` and `document`). `docker-compose.yml`, root `.env`, and git rules (feature branches, no worktrees) live in the **parent** — read `../AGENTS.md`. The root repo tracks only submodule pointers; commit code here first.

## Architecture

- Config: `@nestjs/config` (`ConfigModule.forRoot({ isGlobal: true })` in `AppModule`). No validation schema — required values are read via `getOrThrow` (app fails on boot if missing). `.env` is gitignored; `.env.example` is the committed template (empty placeholders, no fallback values).
- PostgreSQL: `TypeOrmModule.forRootAsync` with `DB_*` vars, `synchronize: true`, `autoLoadEntities: true` (dev; no migrations — schema comes from entities).
- MongoDB: `MongooseModule.forRootAsync` in `AppModule` with `MONGODB_URI`; health check pings it via `@InjectConnection()`. (Both SQL + NoSQL databases are live datastores, not optional.)
- Redis: `src/modules/redis/redis.module.ts` — global module providing `REDIS_CLIENT` (ioredis) from `REDIS_HOST`/`REDIS_PORT`; quits the client on module destroy (keeps jest e2e from hanging).
- `GET /health` (`AppController.getHealth` / `AppService.getHealth`): actuator-style payload — `application`, `postgresql`, `redis`, `mongodb` and `minio` are all real checks reporting `UP`/`DOWN`. The e2e spec asserts this exact payload — update `test/app.e2e-spec.ts` when components change.
- MinIO: `src/modules/file/file.module.ts` — global module providing `MINIO_CLIENT` (minio SDK) from `MINIO_ENDPOINT` (full URL, e.g. `http://localhost:9000`), `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`; on module init it creates the `MINIO_BUCKET` if missing and applies a public read policy. `src/common/constants/file.constant.ts` holds the `MINIO_CLIENT` injection token.
- Dockerfile: multi-stage (deps/dev/build/production); parent compose builds `target: production` and its healthcheck curls `localhost:3000/health`.
- Env keys required at boot: `PORT`, `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`, `REDIS_HOST`, `REDIS_PORT`, `MONGODB_URI`, `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET`. Local dev connects to the compose infra via published ports (postgres = **5433**, not 5432 — a native PostgreSQL owns 5432 on this machine); the BE container maps 3001 → 3000.

## Commands

- `pnpm install`
- `pnpm start:dev` — watch-mode dev server
- `pnpm build` — typechecks and emits to `dist/` via Nest CLI; `pnpm start:prod` runs `node dist/main`
- `pnpm test` — unit tests (jest, `rootDir: src`, `*.spec.ts` colocated with source); filter with `pnpm test <name>`
- `pnpm test:e2e` — e2e tests (`test/jest-e2e.json`, `*.e2e-spec.ts` in `test/`); requires the compose postgres + redis running
- `pnpm lint` — eslint **with `--fix`** (mutates files); type-aware rules from `recommendedTypeChecked`
- No `typecheck` script — `pnpm build` (or `npx tsc --noEmit`) is the type check

## Conventions

- Prettier: `singleQuote: true`, `trailingComma: "all"` (`.prettierrc`); ESLint `prettier/prettier` sets `endOfLine: "auto"` (Windows CRLF-safe). ESLint uses type-aware `recommendedTypeChecked` but `no-explicit-any` is allowed and most `no-unsafe-*` rules (call/return/member-access/assignment) are explicitly off; it warns on `no-floating-promises`
- Scaffold code with `pnpm exec nest g <schematic> <name>` (sourceRoot `src`, build deletes `dist/` first)
- Unit tests colocated as `*.spec.ts` next to source; e2e specs go in `test/`; new features should get both
