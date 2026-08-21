# T0-07: Profile management & password change — Design

Date: 2026-08-21
Task card: `ba/tasks/phase-0-foundation/T0-07-profile-password.md` (US-003, FR-03, UC06/UC13)
Depends on: T0-05 (registration), T0-06 (login/JWT/RBAC)

## Goal

A logged-in user (Learner or Instructor) can view and update their profile
(name, email, avatar) and change their password. Wrong current password keeps
the old password. Avatar files are stored in MinIO via the global `FileModule`.

## Endpoints

All routes live in `UsersController` under `/users/me` and require
`JwtAuthGuard`. Ownership is implicit: the user id always comes from the JWT
(`@CurrentUser()`), never from the request.

| Method | Path                | Body / Field                          | Success | Errors |
|---|---|---|---|---|
| GET    | `/users/me`         | –                                     | 200 safe user | 401 |
| PATCH  | `/users/me`         | `{ name?, email? }`                   | 200 updated safe user | 400 validation, 409 email taken |
| PATCH  | `/users/me/password`| `{ currentPassword, newPassword }`    | 200 `{ passwordChanged: true }` | 400 wrong current / weak new |
| POST   | `/users/me/avatar`  | multipart field `avatar` (image ≤ 5MB)| 200 safe user with avatar URL | 400 no file / bad type / too large |

Password confirmation ("nhập lại mật khẩu mới") is a **frontend-only** zod
refinement; the API contract stays at current + new.

## DTOs (`src/modules/users/dto/user.dto.ts`)

- `UpdateProfileDto`: optional `name` (2–100 chars, trimmed), optional `email`
  (trimmed + lowercased). Both absent = no-op returning current profile.
- `ChangePasswordDto`: `currentPassword` (non-empty),
  `newPassword` matching the same policy regex as registration:
  `/^(?=.*[A-Za-z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/`.
- Rename `RegisterUserResponse` → `UserResponse` (now the general safe-user
  shape; auth service reuses it).

## Service (`UsersService`)

```txt
getProfile(userId)                  -> UserResponse        (404 if missing)
updateProfile(userId, dto)          -> UserResponse        (409 if email taken by someone else)
changePassword(userId, dto)         -> void                (BadRequest "Current password is incorrect")
uploadAvatar(userId, file)          -> UserResponse        (MinIO putObject, best-effort delete of old object)
```

- Password compare/hash uses `bcryptjs` (same as auth/registration).
- Avatar object key: `avatars/{userId}/{uuid}.{ext}`; public URL is
  `${MINIO_ENDPOINT}/${MINIO_BUCKET}/${key}` (bucket has a public read policy).
- Allowed mime types: jpeg/png/webp/gif; max size 5 MB (multer `fileFilter` +
  `limits`). Multer default memory storage provides `file.buffer`.

## Module wiring

No new modules. `FileModule` is global and exports `MINIO_CLIENT`;
`ConfigModule` is global. `UsersService` injects both for the avatar upload.
`UsersController` guards each `/users/me` route with `JwtAuthGuard`
(`RolesGuard` not needed — any authenticated role may manage its own profile).

## Frontend

- `services/api/users.ts`: `getMyProfile`, `updateMyProfile`,
  `changeMyPassword`, `uploadMyAvatar` (FormData) through the shared axios
  instance.
- `lib/schemas/profile.ts`: `profileSchema` (name) and
  `changePasswordSchema` (current/new/confirm + match refinement, same policy
  message as registration).
- `lib/features/authSlice.ts`: new `setUser` reducer so updates reflect
  immediately in persisted Redux state.
- `hooks/useUsers.ts`: `useMyProfile()` query + three mutations that write the
  updated user into the react-query cache and Redux on success.
- `components/profile.tsx`: real profile UI (avatar upload + name/email form +
  password form), Vietnamese strings, shadcn cards/fields.
- Routes: `(learner)/profile/page.tsx` (`/profile`) and
  `(instructor)/instructor/profile/page.tsx` (`/instructor/profile`); header
  links added to both layouts.

## Tests

Unit (`*.spec.ts`, colocated):

- `users.service.spec.ts`: updateProfile trims/normalizes + conflict,
  changePassword wrong-current/success/hash, uploadAvatar stores to MinIO and
  returns URL, getProfile 404.
- `users.controller.spec.ts`: delegation incl. guard usage.

E2E (`test/users.e2e-spec.ts`, extends existing spec):

- 401 without token on every `/users/me` route.
- GET/PATCH `/users/me` happy path persists changes.
- Email conflict → 409.
- Wrong current password → 400 "Current password is incorrect", old password
  still logs in.
- Successful change → old password rejected, new accepted.
- Weak newPassword → 400 policy message.
- Avatar without file → 400; with PNG → 200 + URL (requires compose MinIO).

## Out of scope

- Admin user management (T0-08).
- Password reset / email verification.
- Avatar deletion endpoint (removing the old object is best-effort only).
