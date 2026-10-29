# Notification Socket.IO CORS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure notification Socket.IO CORS from the same `FRONTEND_URLS` allowlist used by HTTP CORS.

**Architecture:** Parse and validate `FRONTEND_URLS` once during bootstrap. Pass the resulting origins to both `app.enableCors()` and a custom global `IoAdapter` subclass that overrides `createIOServer()` to apply Socket.IO CORS options. Remove the gateway's hard-coded CORS metadata.

**Tech Stack:** NestJS 11, `@nestjs/platform-socket.io` `IoAdapter`, Socket.IO, Jest.

**Spec:** `docs/superpowers/specs/2026-10-29-notification-socket-cors-design.md`

## Global Constraints

- Reuse the existing comma-separated `FRONTEND_URLS` setting for HTTP and Socket.IO origins.
- Enable credentialed CORS and do not use wildcard origins.
- Preserve the current allowed handshake headers: `Authorization` and `Content-Type`.
- Keep socket JWT authentication, room membership, event names, and transport behavior unchanged.
- Startup must fail clearly when `FRONTEND_URLS` is missing or empty.

## Review Focus

- Whitespace around comma-separated origins: trim each origin; test the parsed allowlist.
- Missing or all-whitespace `FRONTEND_URLS`: startup must fail with a clear configuration error; test the parser/validation helper.
- Credentialed handshakes: Socket.IO CORS must retain `credentials: true`; assert adapter server options.
- Origin isolation: Socket.IO must receive only configured origins and no wildcard; assert adapter server options.
- Existing gateway behavior: token verification, joining rooms, and rejecting invalid sockets must stay unchanged; run the focused gateway spec after implementation.

---

### Task 1: Add the configured Socket.IO adapter

**Files:**
- Create: `src/common/adapters/configured-socket-io.adapter.ts`
- Test: `src/common/adapters/configured-socket-io.adapter.spec.ts`

**Interfaces:**
- Produces: `ConfiguredSocketIoAdapter extends IoAdapter`, constructed with the Nest application and `readonly string[]` allowed origins.
- `createIOServer(port: number, options?: Record<string, unknown>): unknown` delegates to `super.createIOServer()` with the supplied options and CORS set to `{ origin: allowedOrigins, credentials: true, allowedHeaders: ['Authorization', 'Content-Type'] }`.

- [x] **Step 1: Write the failing adapter tests**

  Cover that `createIOServer()` delegates with the configured exact origins, enables credentials, preserves allowed headers, and retains non-CORS gateway options such as `path`.

- [x] **Step 2: Run the adapter spec and confirm it fails**

  Run: `pnpm test -- --runInBand src/common/adapters/configured-socket-io.adapter.spec.ts`
  Expected: FAIL because the adapter does not exist yet.

- [x] **Step 3: Implement `ConfiguredSocketIoAdapter`**

  Extend Nest's `IoAdapter`; merge caller options while ensuring the configured CORS policy is authoritative. Do not mutate gateway instances or server internals after creation.

- [x] **Step 4: Run the adapter spec**

  Run: `pnpm test -- --runInBand src/common/adapters/configured-socket-io.adapter.spec.ts`
  Expected: PASS.

### Task 2: Share and validate `FRONTEND_URLS` at bootstrap

**Files:**
- Modify: `src/main.ts`
- Modify: `src/modules/notifications/notifications.gateway.ts`
- Test: `src/common/adapters/frontend-origins.spec.ts` (or equivalent focused helper spec if parsing is kept in a small helper)
- Test: `src/modules/notifications/notifications.gateway.spec.ts`

**Interfaces:**
- Consumes: `ConfiguredSocketIoAdapter` from Task 1.
- Produces: bootstrap code that parses `FRONTEND_URLS` into a trimmed non-empty `string[]`, passes it to HTTP CORS, and constructs/registers the adapter with the same list.

- [x] **Step 1: Extract and test origin parsing**

  Add a small helper only if needed to test parsing cleanly. Assert that `https://app.example, https://admin.example/` becomes `['https://app.example', 'https://admin.example/']`, while missing, empty, or whitespace-only values fail clearly.

- [x] **Step 2: Run the parsing spec and confirm it fails**

  Run: `pnpm test -- --runInBand src/common/adapters/frontend-origins.spec.ts`
  Expected: FAIL until the parsing helper exists.

- [x] **Step 3: Wire shared origins into HTTP and WebSocket bootstrap**

  In `src/main.ts`, obtain `FRONTEND_URLS` using `ConfigService`, parse it once, pass the list to `app.enableCors()`, then register `new ConfiguredSocketIoAdapter(app, frontendUrls)` with `app.useWebSocketAdapter(...)` before `app.listen()`.

- [x] **Step 4: Remove gateway CORS metadata**

  Remove the hard-coded `cors` object from `@WebSocketGateway` while preserving other gateway options (if any). Do not change socket authentication or event handling.

- [x] **Step 5: Run focused backend verification**

  Run: `pnpm test -- --runInBand src/common/adapters/configured-socket-io.adapter.spec.ts src/common/adapters/frontend-origins.spec.ts src/modules/notifications/notifications.gateway.spec.ts`
  Expected: PASS, including existing gateway auth and room behavior tests.

- [x] **Step 6: Review the resulting diff**

  Confirm HTTP and Socket.IO use the same parsed list, gateway metadata has no localhost origin, and no unrelated socket behavior changed.
