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

### Tests

- **New unit test** `src/app.service.spec.ts` (colocated, jest):
  - All clients OK ⇒ `getHealth()` resolves with the full payload, no throw.
  - One client rejects (e.g. minio `listBuckets` throws) ⇒ rejects/throws `ServiceUnavailableException` whose `getResponse()` carries the payload with the `DOWN` component + `details.error`.
- **e2e** `test/app.e2e-spec.ts`: **unchanged** — all-up ⇒ 200 + exact payload. Verified green with compose infra running (`pnpm test:e2e`).

### DoD verification

- `pnpm lint` + `pnpm build` green in `online-study-platform-be`.
- All imports **relative** (current code already conforms).
- Feature branch `feature/t0-03-health-503`; never `main`.

## Out of scope

- Module skeleton for auth/users/courses/etc. — criterion removed from card T0-03.
- Changing the payload shape (no top-level `status` field).
- Boot-time failure behavior (already crashes on minio-down; unchanged).
