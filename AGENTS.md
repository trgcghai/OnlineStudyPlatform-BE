# online-study-platform-be

NestJS 11 + TypeScript backend (CJS, `module: nodenext` in tsconfig — relative imports are extensionless). Package manager: **pnpm** (do not use npm/yarn). Still the untouched NestJS starter: only `AppModule`/`AppController`/`AppService` exist; no DB, no `@nestjs/config`, no .env loading (`src/main.ts` reads `process.env.PORT ?? 3000` directly).

## Commands

- `pnpm install`
- `pnpm start:dev` — watch-mode dev server
- `pnpm build` — typechecks and emits to `dist/` via Nest CLI; `pnpm start:prod` runs `node dist/main`
- `pnpm test` — unit tests (jest, `rootDir: src`, `*.spec.ts` colocated with source)
- `pnpm test:e2e` — e2e tests (`test/jest-e2e.json`, `*.e2e-spec.ts` in `test/`)
- `pnpm lint` — eslint **with `--fix`** (mutates files); type-aware rules from `recommendedTypeChecked`
- No `typecheck` script — `pnpm build` (or `npx tsc --noEmit`) is the type check

## Conventions

- Prettier: `singleQuote: true`, `trailingComma: "all"` (`.prettierrc`); ESLint allows `no-explicit-any` but warns on `no-floating-promises`
- Scaffold code with `pnpm exec nest g <schematic> <name>` (sourceRoot `src`, build deletes `dist/` first)
- Unit tests colocated as `*.spec.ts` next to source; e2e specs go in `test/`; new features should get both
