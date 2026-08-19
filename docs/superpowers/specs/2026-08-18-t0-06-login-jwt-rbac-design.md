# T0-06 Login / Logout + JWT + RBAC - Backend Design

**Date:** 2026-08-18  
**Status:** Approved for spec review  
**Epic:** Accounts  
**UC:** UC06/UC13  
**FR:** FR-02, FR-04, FR-05  
**Repos:** BE first; FE implementation later  
**Depends on:** T0-05 registration

## Goal

Implement secure backend authentication for registered users. An active user can log in with email and password, receive a JWT access token, keep a refresh session through an HttpOnly cookie, refresh expired access tokens, and log out. Protected routes use Passport JWT authentication and role-based guards for `Admin`, `Instructor`, and `Learner`.

## Decisions

| Topic | Decision |
|---|---|
| Access-token auth | Passport JWT strategy |
| Refresh-session storage | Redis-backed sessions |
| Refresh-token transport | HttpOnly cookie only |
| Access-token transport | JSON response body |
| Logout behavior | Delete Redis refresh session and clear refresh cookie |
| Refresh behavior | Verify cookie token, check Redis session, rotate refresh session, return new access token |
| RBAC sample routes | Keep under `/auth`: `/auth/admin`, `/auth/instructor`, `/auth/learner` |
| Invalid credentials message | `Invalid email or password` |
| Disabled account message | `Account disabled` |

## Module Architecture

Add `AuthModule` and keep `UsersModule` responsible for user persistence.

New auth files:

```txt
src/modules/auth/auth.module.ts
src/modules/auth/auth.controller.ts
src/modules/auth/auth.service.ts
src/modules/auth/dto/login.dto.ts
src/modules/auth/strategies/jwt.strategy.ts
src/modules/auth/guards/jwt-auth.guard.ts
src/modules/auth/guards/roles.guard.ts
src/modules/auth/decorators/current-user.decorator.ts
src/modules/auth/decorators/roles.decorator.ts
src/modules/auth/types/authenticated-user.type.ts
```

Module dependencies:

```txt
AuthModule -> UsersModule
AuthModule -> JwtModule
AuthModule -> global RedisModule
```

`AuthModule` is imported by `AppModule`. Redis is already global, so auth can inject `REDIS_CLIENT` without re-registering Redis.

## User Service Support

Add internal lookup methods to `UsersService`:

```ts
findByEmail(email: string): Promise<User | null>
findById(id: string): Promise<User | null>
```

`findByEmail` is used only by backend auth logic and must provide access to the stored password hash for bcrypt comparison. Controllers must continue returning safe user responses without `password`.

If auth touches `src/modules/users/dto/user.dto.ts`, fix the existing absolute import from `src/modules/users/entities/user.entity` to a relative import because backend Jest cannot resolve `src/...` imports.

## Environment Variables

Add required auth configuration to `.env.example` and runtime config:

```env
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d
```

Read secrets and TTLs through `ConfigService.getOrThrow`, matching the existing no-fallback backend convention.

## Login Flow

Endpoint:

```txt
POST /auth/login
```

DTO:

```ts
email: valid email, transformed to trim + lowercase
password: string, non-empty
```

Service behavior:

1. Normalize email.
2. Load user by email.
3. If no user exists, throw `UnauthorizedException('Invalid email or password')`.
4. Compare password with `bcryptjs.compare`.
5. If password does not match, throw `UnauthorizedException('Invalid email or password')`.
6. If `user.status === UserStatus.INACTIVE`, throw `ForbiddenException('Account disabled')`.
7. Create an access token.
8. Create a refresh token containing a generated `sessionId`.
9. Store refresh session metadata in Redis with TTL matching `JWT_REFRESH_TTL`.
10. Set the refresh token cookie.
11. Return access token and safe user data.

Response data before the global response interceptor wraps it:

```json
{
  "accessToken": "...",
  "user": {
    "id": "...",
    "name": "...",
    "email": "learner@example.com",
    "role": "Learner",
    "status": "Active",
    "avatar": null
  }
}
```

## Tokens And Redis Sessions

Access token payload:

```ts
{
  sub: string;
  email: string;
  role: UserRole;
}
```

Refresh token payload:

```ts
{
  sub: string;
  sessionId: string;
}
```

Redis key shape:

```txt
auth:refresh:<userId>:<sessionId>
```

Store enough metadata to validate and clean up the session, such as user id, session id, and creation timestamp. The Redis key TTL must match refresh-token expiry.

Refresh cookie settings:

```txt
name: refreshToken
httpOnly: true
sameSite: lax
secure: true in production only
path: /auth
maxAge: JWT_REFRESH_TTL converted to milliseconds
```

## Refresh Flow

Endpoint:

```txt
POST /auth/refresh
```

Service behavior:

1. Read `refreshToken` cookie.
2. If missing, throw `UnauthorizedException`.
3. Verify with `JWT_REFRESH_SECRET`.
4. Check Redis key `auth:refresh:<userId>:<sessionId>` exists.
5. Reload the user by id.
6. If no user exists, delete the Redis session and throw `UnauthorizedException`.
7. If the user is inactive, delete the Redis session and throw `ForbiddenException('Account disabled')`.
8. Rotate refresh session: delete the old Redis key, create a new session id, issue a new refresh token, and set a new cookie.
9. Return a new access token and safe user data.

Rotation means a stolen old refresh token stops working after a successful refresh.

## Logout Flow

Endpoint:

```txt
POST /auth/logout
```

Service behavior:

1. Read `refreshToken` cookie if present.
2. If token verifies, delete Redis key `auth:refresh:<userId>:<sessionId>`.
3. Clear the refresh cookie regardless of whether token verification succeeds.
4. Return success using the existing response format.

Logout does not revoke already-issued access tokens. They expire naturally after the short access-token TTL. This keeps access-token validation stateless and uses Redis only for refresh-session revocation.

## Passport JWT And Current User

`JwtStrategy` reads access tokens from `Authorization: Bearer <token>` and verifies them with `JWT_ACCESS_SECRET`.

Validation behavior:

1. Extract `sub`, `email`, and `role` from the JWT payload.
2. Reload the user by `sub`.
3. Reject missing users with `UnauthorizedException`.
4. Reject inactive users with `ForbiddenException('Account disabled')`.
5. Attach the authenticated user shape to `request.user`.

Authenticated request user shape:

```ts
{
  id: string;
  email: string;
  role: UserRole;
  status: UserStatus;
}
```

`@CurrentUser()` returns this authenticated user object for controllers.

## RBAC

Decorators and guards:

```ts
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
```

Behavior:

```txt
No token -> 401
Invalid or expired token -> 401
Valid token but inactive user -> 403 Account disabled
Valid token but wrong role -> 403
Valid token and matching role -> 200
```

Sample T0-06 acceptance routes:

```txt
GET /auth/me          any authenticated user
GET /auth/admin       Admin only
GET /auth/instructor  Instructor only
GET /auth/learner     Learner only
```

These routes are intentionally simple. Later tasks can reuse the same guards on real profile, admin, course, and AI gateway routes.

## Error Handling

Credential failures must not reveal whether the email exists:

```txt
Wrong email -> 401 Invalid email or password
Wrong password -> 401 Invalid email or password
```

Disabled account returns the specific acceptance-criteria message:

```txt
Inactive user -> 403 Account disabled
```

The existing global exception filter wraps errors in the current API shape:

```json
{
  "success": false,
  "statusCode": 401,
  "data": null,
  "error": {
    "code": 401,
    "message": "Invalid email or password",
    "details": []
  },
  "timestamp": "..."
}
```

## Tests

Unit tests:

```txt
AuthService
- valid login issues access token, sets refresh token data, and stores Redis session
- missing user throws Invalid email or password
- wrong password throws Invalid email or password
- inactive user throws Account disabled
- refresh validates Redis session and rotates tokens
- refresh rejects missing cookie, invalid token, missing Redis session, missing user, and inactive user
- logout deletes Redis session when token is valid
- logout still clears cookie when token is absent or invalid

JwtStrategy
- validates active user payload
- rejects missing user
- rejects inactive user

RolesGuard
- allows matching role
- rejects wrong role
- allows route with no role metadata if authenticated
```

E2E tests in `test/auth.e2e-spec.ts`:

```txt
POST /auth/login succeeds for active Learner
POST /auth/login rejects wrong password with generic message
POST /auth/login rejects inactive account with Account disabled
GET /auth/me without token returns 401
GET /auth/me with token returns current user
POST /auth/refresh returns a new access token using refresh cookie
POST /auth/logout invalidates refresh session; later refresh fails
GET /auth/admin allows Admin and rejects Learner
GET /auth/instructor allows Instructor and rejects Learner
GET /auth/learner allows Learner and rejects Admin or Instructor
```

E2E setup should create users directly with TypeORM and bcrypt-hashed passwords, then remove them in `afterAll`. Tests must account for the existing global response interceptor and exception filter.

## Out Of Scope

- Frontend login page and interceptor wiring.
- Password change and profile APIs; those belong to T0-07.
- Admin user-management APIs; those belong to T0-08.
- Email verification and password reset.
- Persistent audit trail for sessions.
- Global auth guard across every route; protected routes opt in with guards for now.
