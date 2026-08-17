# Health endpoint fails loudly (503) when a dependency is down

**Date:** 2026-08-17
**Task:** T0-03 (leftover acceptance criterion: "Health fails loudly when a dependency is down (e.g. minio not running ⇒ non-200)")
**Repo:** online-study-platform-be (feature branch `feature/t0-03-health-503`)

## Goal

`GET /health` must return HTTP **503** (instead of 200) when any of the four infra components (`postgresql`, `redis`, `mongodb`, `minio`) is `DOWN`, while keeping the existing response body byte-identical.

## Context

- `AppController.getHealth` → `AppService.getHealth` already performs real checks on all 5 components (`application`, `postgresql`, `redis`, `mongodb`, `minio`) — no mocks (`src/app.service.ts`).
- Today the endpoint always returns 200, even when a component reports `DOWN` with error details.
- Minio-down at boot already crashes the app (`FileModule.onModuleInit` → `bucketExists` throws); this change covers **runtime** degradation.
- `test/app.e2e-spec.ts` asserts the exact all-up payload — must stay green unchanged.

## Design

### Implementation

`src/app.service.ts` — `getHealth()`:

1. Compute the payload exactly as today (5 real component checks in parallel).
2. If any of `postgresql` / `redis` / `mongodb` / `minio` is `DOWN`, throw `new ServiceUnavailableException(payload)`.
3. NestJS serializes the passed object verbatim as the response body with status **503**. `application` remains `UP` (the app itself is running).
4. All-up path returns the payload unchanged (200).

`AppController` is untouched — no `@Res()`, no filters, no interceptors.

### Behavior example (minio down)

```
HTTP/1.1 503 Service Unavailable

{
  "components": {
    "application": { "status": "UP" },
    "postgresql": { "status": "UP" },
    "redis": { "status": "UP" },
    "mongodb": { "status": "UP" },
    "minio": { "status": "DOWN", "details": { "error": "<message>" } }
  }
}
```

### Error handling

- Any infra check failing ⇒ overall `DOWN` ⇒ 503. Partial failures are allowed — the payload still reports the remaining components as `UP`.
- `application` always `UP`; the app responding is proof of application liveness.

### Fail-fast hardening (approved follow-up)

Observed: stopping redis via `docker compose stop redis` left `/health` hanging with no response. Root cause: ioredis defaults (`enableOfflineQueue: true` + unbounded `retryStrategy`) queue the `ping()` indefinitely while disconnected, so `Promise.all` never settles; mongoose buffers the ping for ~10s (`bufferTimeoutMS`) before failing. Fix — two complementary changes inside `src/app.service.ts` (no client config changes):

1. **Connection-state short-circuits:**
   - `checkRedis()`: if `this.redisClient.status !== 'ready'` ⇒ return `{ status: 'DOWN', details: { error: 'redis not connected (status: <status>)' } }` immediately — no ping issued.
   - `checkMongo()`: if `this.mongooseConnection.readyState !== 1` ⇒ return `{ status: 'DOWN', details: { error: 'mongodb not connected (readyState: <n>)' } }` immediately — no ping issued.
   - Postgres/minio unchanged (`connection refused` already fails fast).

2. **Per-check timeout (safety net so `/health` can never hang):**
   - Refactor the four near-identical `check*` methods into one private helper `check(name, run)` — same try/catch semantics as today (`{ status: 'UP' }` / `{ status: 'DOWN', details: { error } }`), plus a `Promise.race` against a timer of **`HEALTH_CHECK_TIMEOUT_MS = 3000`**; on timeout the component reports `DOWN` with `details.error: '<name> health check timed out'`. Timer cleared in `finally`.
   - Payload shape and 503 semantics unchanged regardless of which check fails or times out.

### Tests

- **New unit test** `src/app.service.spec.ts` (colocated, jest):
  - All clients OK ⇒ `getHealth()` resolves with the full payload, no throw.
  - One client rejects (e.g. minio `listBuckets` throws) ⇒ rejects/throws `ServiceUnavailableException` whose `getResponse()` carries the payload with the `DOWN` component + `details.error`.
  - Redis client `status: 'reconnecting'` ⇒ fast `DOWN` with `redis not connected` in `details.error` (no ping issued).
  - Mongoose `readyState: 0` ⇒ fast `DOWN` with `mongodb not connected` in `details.error` (no ping issued).
  - A check whose promise never settles ⇒ `DOWN` with `health check timed out` in `details.error` (jest fake timers, advance past 3000ms).
- **e2e** `test/app.e2e-spec.ts`: **unchanged** — all-up ⇒ 200 + exact payload. Verified green with compose infra running (`pnpm test:e2e`).
- **Real-infra verification:** `docker compose stop redis` ⇒ `/health` responds **503 within ~3s** with `redis: DOWN`; `docker compose start redis` ⇒ back to 200 all UP.

### DoD verification

- `pnpm lint` + `pnpm build` green in `online-study-platform-be`.
- All imports **relative** (current code already conforms).
- Feature branch `feature/t0-03-health-503`; never `main`.

## Out of scope

- Module skeleton for auth/users/courses/etc. — criterion removed from card T0-03.
- Changing the payload shape (no top-level `status` field).
- Boot-time failure behavior (already crashes on minio-down; unchanged).
