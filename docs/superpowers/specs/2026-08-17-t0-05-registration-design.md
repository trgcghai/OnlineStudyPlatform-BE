# T0-05 Registration (US-001) — Design

**Date:** 2026-08-17
**Status:** Approved (pending spec review)
**Epic:** Accounts | **UC:** UC21 | **FR:** FR-01
**Repos:** BE (this doc) + FE (wiring section below)
**Depends on:** T0-03 (health/scaffold), T0-04 (FE shell, `/register` placeholder)

## Goal

A guest registers an account via `POST /users` on the BE and the FE `/register` form is wired to it. On success the account is created with role `Learner` and status `Active`, a success message is shown and the guest is redirected to `/signin`. Duplicate email is rejected with a field-level error; invalid input is rejected inline.

## Decisions (from brainstorming)

| Topic | Decision |
|---|---|
| FE form approach | react-hook-form + zod (add both deps; reused by T0-06 login, T0-07 profile, later course/quiz forms) |
| Error text language | BE returns stable **English** messages; FE maps them to **Vietnamese** copy next to fields (e2e asserts English, UI stays Vietnamese) |
| Password policy | min 8 chars + at least one letter, one number, one special char |
| Password hashing | **bcryptjs** (pure JS — no native build on Windows dev nor alpine Docker image) |
| Module layout | UsersModule (user's existing scaffold), endpoint `POST /users` |
| `id` type | **uuid v4** (`@PrimaryGeneratedColumn('uuid')`) |
| Duplicate handling | DB unique constraint + catch PG error `23505` → `409 ConflictException('Email already registered')` (race-proof, no pre-check) |
| Entity shape | Follows `document/` thesis spec exactly (id, name, email, password, role, avatar, created_at, updated_at) **plus** `status` column (card requirement; not yet in the thesis — see `ba/notes/doc-fixes.md`) |

## 1. Entity `User`

File: `src/modules/users/entities/user.entity.ts`, table `users`, registered via UsersModule + `autoLoadEntities` (`synchronize: true` creates it).

| Column | Type | Constraints |
|---|---|---|
| `id` | uuid v4 | PK, `@PrimaryGeneratedColumn('uuid')` |
| `name` | varchar(100) | not null |
| `email` | varchar(255) | not null, **unique** |
| `password` | varchar (bcryptjs hash, cost 10) | not null |
| `role` | enum `Admin` \| `Instructor` \| `Learner` | not null, default `Learner` |
| `avatar` | varchar nullable | null (filled in T0-07) |
| `status` | enum `Active` \| `Inactive` | not null, default `Active` |
| `created_at` | timestamp | `@CreateDateColumn({ name: 'created_at' })` |
| `updated_at` | timestamp | `@UpdateDateColumn({ name: 'updated_at' })` |

- TS enums `UserRole` and `UserStatus` in `entities/user.entity.ts` (string values exactly as above — match thesis doc strings).
- No relations yet (Enrollment, Notification, LearningAnalytics, Certificate, Answer arrive in later phases).

## 2. DTO + validation

New deps: `class-validator`, `class-transformer` (BE); `@nestjs/mapped-types` added by the scaffold is **removed** (no update endpoint yet).

- `src/main.ts`: global `app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))`.
- `src/modules/users/dto/user.dto.ts` — replace with a single `CreateUserDto`:
  - `name`: `@IsString()` + `@Transform(trim)` + `@Length(2, 100)`
  - `email`: `@IsEmail()`
  - `password`: `@Matches(/^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/)` with message `'Password must be at least 8 characters and include letters, numbers and a special character'`
- Remove `UpdateUserDto` (deferred with the rest of CRUD to T0-07/08).

## 3. Service `create()`

`src/modules/users/users.service.ts`:
1. Normalize email: trim + lowercase (prevents `Foo@x.com` vs `foo@x.com` duplicates).
2. `bcryptjs.hash(password, 10)`.
3. Save via TypeORM repository.
4. Catch `QueryFailedError` with `driverError.code === '23505'` → `ConflictException('Email already registered')` (409).
5. Return the created user without `password` (via `@Exclude()` + `ClassSerializerInterceptor`; no manual mapping).

## 4. Controller — scoped

`src/modules/users/users.controller.ts`:
- Keep **only** `POST /users` (register) → 201 with `{ id, name, email, role, status, avatar, created_at, updated_at }`.
- Remove scaffold endpoints `GET /users`, `GET /users/:id`, `PATCH /users/:id`, `DELETE /users/:id` — they expose user data (incl. hashes) before auth exists; T0-07 (profile) / T0-08 (admin mgmt) re-add them behind guards.
- Fix scaffold absolute imports (`src/modules/users/...`) → relative (`./dto/user.dto`, `./entities/user.entity`) — jest cannot resolve `src/...` (proven failure, see `file.module.ts` fix in T0-03).
- Update the scaffold unit specs (`users.controller.spec.ts`, `users.service.spec.ts`) to match the trimmed surface.

## 5. Tests

- **Unit** (`users.service.spec.ts`): mock repository. Cases:
  - `create` hashes the password and saves; returns user without `password`
  - duplicate (repo throws 23505) → `ConflictException('Email already registered')`
  - email normalized (trim + lowercase) before save
- **Unit** (`users.controller.spec.ts`): delegates to service; keeps only `create`.
- **e2e** (new `test/users.e2e-spec.ts`, compose infra required, mirrors `test/app.e2e-spec.ts` bootstrap):
  - happy: `POST /users` → 201, body has `role: 'Learner'`, `status: 'Active'`, no `password`; row persisted with hashed password (verify via repository query)
  - duplicate: same email again → 409 with `message: 'Email already registered'`
  - validation: bad email → 400; password `abc12` (short/no special) → 400 with the password message; extra unknown field → 400 (`forbidNonWhitelisted`)
  - teardown: delete the created user(s) in `afterAll`

## 6. FE wiring (runs in the FE repo)

- Add deps: `react-hook-form`, `zod`, `@hookform/resolvers`.
- `app/(auth)/register/page.tsx` — replace EmptyState placeholder with a shadcn Card form (reuse `(auth)` layout):
  - Fields: Họ và tên, Email, Mật khẩu (+ show/hide toggle optional) — zod schema mirrors BE rules (name 2–100, email format, password min 8 + letters + numbers + special)
  - Submit → `axiosClient.post('/users', ...)` (`services/axios.ts`; note `withCredentials` cookie config is harmless for now — no cookies set by register)
  - Success → inline shadcn `Alert` (success variant) above the form + `router.push('/signin?registered=1')` after a short delay (query param lets T0-06 login show a welcome banner; no Toaster/provider setup needed)
  - 409 → "Email đã được đăng ký" next to the email field
  - 400 → map BE validation messages to fields (email/password), Vietnamese copy
  - Loading state on the submit button; disabled during submit
- Out of scope: login page (T0-06), Redux auth state updates (no session yet).

## 7. Doc-fix note

Added `status` column to the entity that the thesis does not (yet) define — see **`ba/notes/doc-fixes.md`** for the exact places to fix (`document/TruongCongHai_HuynhThanhLiem.md` §3.5.1 table, `document/erd/erd.drawio` User swimlane, regenerate `.docx`).

## Out of scope (explicit)

- Login / JWT / RBAC (T0-06), profile + password change (T0-07), admin user management incl. disable (T0-08), email verification, confirm-password field, avatar upload.
