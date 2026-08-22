# T0-08: Admin user management — Design

Date: 2026-08-22
Task card: `ba/tasks/phase-0-foundation/T0-08-admin-user-mgmt.md` (US-010, FR-10, UC01)
Depends on: T0-06 (login/JWT/RBAC)

## Goal

An Admin can list, create, edit, and disable Instructor and Learner accounts.
Admins themselves are **outside the management scope** (no listing, creation,
editing, or disabling of Admin accounts through this API). Disabling an
account makes its next login fail with "Account disabled" and kills existing
sessions (reuses T0-06 behavior).

## Endpoints (`src/modules/users/admin-users.controller.ts`)

New `AdminUsersController` at `/users/admin`. Guards are applied at class
level — `@UseGuards(JwtAuthGuard, RolesGuard)` + `@Roles(UserRole.ADMIN)` — so
every route below is admin-only; anonymous callers get 401, non-admin roles
get 403 from `RolesGuard` before any handler logic runs. Responses are wrapped
by the global `ResponseInterceptor` (`{ success, statusCode, data, timestamp }`).

| Method | Path                        | Body / Query                                              | Success | Errors |
|---|---|---|---|---|
| GET    | `/users/admin`              | `?role&status&q&page&limit` (all optional)                | 200 `{ items, total, page, limit, totalPages }` | 400 invalid query, 401, 403 |
| POST   | `/users/admin`              | `{ name, email, password, role }`                         | 201 safe user | 400 validation / weak password, 409 email taken, 403 role=Admin |
| PATCH  | `/users/admin/:id`          | `{ name?, email?, password?, role?, status? }`            | 200 updated safe user | 400 empty payload / validation, 404 unknown id, 409 email taken |
| PATCH  | `/users/admin/:id/disable`  | –                                                         | 200 safe user with `status: Inactive` | 404 unknown id, 403 target is Admin |

`ParseUUIDPipe` guards `:id` on both PATCH routes (malformed uuid → 400).
Disable returns 200 (not 204) so the interceptor wraps a usable body.

### List semantics

- TypeORM `QueryBuilder`; role filter restricted to `IN ('Instructor','Learner')`
  (an explicitly requested `role=Admin` yields an empty result rather than
  leaking admin accounts).
- `q` performs case-insensitive search on name or email (`ILIKE %q%`).
- Ordered by `createdAt DESC`, offset pagination via `skip/take`,
  `getManyAndCount()` for the total.
- Defaults: `page = 1`, `limit = 10` (max 100). Invalid enum values → 400 from
  the global `ValidationPipe`.

## Management scope (`dto/admin-user.dto.ts`)

`ADMIN_ASSIGNABLE_ROLES = ['Instructor', 'Learner']` and
`ADMIN_MANAGEABLE_STATUSES = ['Active', 'Inactive']` are the single source of
truth, exported from the DTO module and reused by the service:

- create/edit reject `role: 'Admin'` → 400 (DTO enum blocks it first;
  service re-checks defensively);
- disable rejects Admin targets → 403 "Admin accounts cannot be managed here";
- list can never return an Admin row.

This keeps the invariant "there is always at least one bootstrap Admin" —
admins are only ever created by the seed (`SampleUsersSeed`).

## DTOs

- `AdminListUsersQueryDto`: optional `role` (assignable enum), `status`
  (manageable enum), `q` (trimmed string), `page`/`limit` (positive ints,
  `limit ≤ 100`). Global pipe runs with `whitelist` + `forbidNonWhitelisted`.
- `CreateAdminUserDto`: `name` (2–100 chars), `email` (normalized to trimmed
  lowercase), `password` matching the registration policy regex
  `/^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/`, `role` (assignable enum).
- `UpdateAdminUserDto`: all optional; same constraints. A request whose body
  carries no known field → 400 "No changes provided" (service-level check,
  because `whitelist` strips unknown keys before validation).

## Service (`UsersService` additions)

```txt
findAllForAdmin(query)   -> { items: UserResponse[], total, page, limit, totalPages }
createAsAdmin(dto)       -> UserResponse   (bcrypt hash; 23505 → 409)
updateAsAdmin(id, dto)   -> UserResponse   (404 unknown id; 400 empty payload;
                                            optional password reset re-hashed;
                                            email conflict → 409)
disableUser(id)          -> UserResponse   (404 unknown id; 403 Admin target;
                                            idempotent when already Inactive)
```

All methods return the shared safe-user shape (`UserResponse`, no password
hash). `createAsAdmin` delegates to the existing `create(dto, { role })`
path used by registration, so password hashing and normalization stay in one
place.

### Disable semantics

1. Load user; 404 if missing, 403 if role ∉ assignable scope.
2. Already `Inactive` → return as-is (**idempotent**, no Redis churn).
3. Persist `status = Inactive`.
4. Best-effort revocation of refresh sessions: `KEYS auth:refresh:{userId}:*`
   then `DEL` each key via the global `REDIS_CLIENT`. Failures are logged and
   swallowed — a Redis outage must not leave the account enabled.

Enforcement of "disabled ⇒ cannot use the system" lives in the T0-06 layer:

- login (`auth.service.ts`) rejects inactive users → 403 "Account disabled";
- refresh rejects inactive users the same way;
- `jwt.strategy.ts#validate()` loads the user from the DB on **every**
  authenticated request and throws 403 "Account disabled" for non-Active
  status — so already-issued access tokens die immediately after disabling,
  not just at their TTL expiry.

## Module wiring

`AdminUsersController` registered alongside `UsersController` in
`UsersModule`. No new modules: `RedisModule` is global (`REDIS_CLIENT`),
`ConfigModule` is global. `UsersService` injects `REDIS_CLIENT` for the
revocation step. `RolesGuard` + `JwtAuthGuard` come from `common/` and are
referenced directly by the controller decorator; `UsersController` keeps its
own per-route guarding untouched (its routes remain self-service).

## Frontend (contract consumers)

- `services/api/users.ts`: `listAdminUsers(filters)`, `createUserAsAdmin`,
  `updateUserAsAdmin`, `disableUserAsAdmin` through the shared axios client;
  types `AdminUserFilters`, `AdminUserList`.
- `lib/schemas/admin-user.ts`: `ASSIGNABLE_ROLES`, `ADMIN_USER_STATUSES`,
  create/edit zod schemas mirroring the BE password policy (edit password
  optional-but-policy-checked, Vietnamese messages).
- `hooks/useAdminUsers.ts`: query keyed `["admin-users","list",filters]`;
  mutations invalidate the whole `admin-users` group; axios error mapping →
  field errors (409 email taken, 400 policy details) or form-level alerts.
- `app/(admin)/admin/users/page.tsx`: table (role/status/search filters,
  pagination, badges) + `UserFormDialog` (create/edit) +
  `DisableUserDialog` (destructive confirmation). Disabling is only exposed
  as the row action; the edit dialog may re-enable (`status: Active`).

## Tests

Unit (colocated):

- `users.service.spec.ts`: `findAllForAdmin` builds ILIKE search, role IN
  clause, skip/take math; `createAsAdmin` hashes + normalizes;
  `updateAsAdmin` empty-payload rejection, partial update, conflict;
  `disableUser` sets Inactive + revokes sessions, is idempotent, tolerates
  Redis failures, 403 for Admin targets, 404 unknown id.
- `admin-users.controller.spec.ts`: delegation tests + RBAC suite asserting
  class-level metadata (`Reflect.getMetadata(ROLES_KEY, AdminUsersController)`
  equals `['Admin']`), guard allows Admin, anonymous → 401,
  Learner/Instructor → 403, and that `UsersController` has no ROLES metadata.

E2E (`test/admin-users.e2e-spec.ts`, 17 scenarios):

- RBAC: 401 anonymous, 403 learner/instructor on every route, admin list OK,
  no `Admin` rows in list output.
- Filters: role/status/q combinations, invalid role → 400.
- Create instructor: email normalization, hashed password (login works),
  `role=Admin` → 400, duplicate email → 409.
- Edit: name/role change, password reset (old password rejected, new works),
  empty payload → 400, unknown field → 400, unknown id → 404.
- Disable: next login → 403 "Account disabled", old access token → 403 on
  `/users/me`, second disable is idempotent, unknown id → 404.
- Cleanup removes seeded + created users and their Redis keys.

## Verification

- `pnpm lint` 0 errors, `pnpm build` ✓, `pnpm test` 81/81 ✓,
  `pnpm test:e2e --runInBand` 44/44 across 4 suites ✓.
- Live smoke against the compose stack: admin login → list (admins excluded)
  → create instructor → login OK → disable → next login 403 → old token 403
  on `/users/me`.

## Out of scope

- Re-enable endpoint as a dedicated route (re-enabling goes through
  `PATCH /users/admin/:id` with `status: Active`).
- Deleting users; managing other admins; audit log of admin actions.
- Password reset / email verification flows (later phase).
