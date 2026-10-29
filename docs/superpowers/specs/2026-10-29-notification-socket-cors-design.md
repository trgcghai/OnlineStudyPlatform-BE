# Notification Socket.IO CORS Design

## Intent

Use the existing `FRONTEND_URLS` deployment setting for notification Socket.IO handshakes as well as HTTP CORS, so production deployments do not depend on the gateway's hard-coded localhost origin.

## Current behavior

`src/main.ts` reads `FRONTEND_URLS` through `ConfigService` and configures HTTP CORS. `NotificationsGateway` separately hard-codes `http://localhost:3000` in its `@WebSocketGateway` metadata. The gateway already injects `ConfigService` for token verification, but decorator options are static and cannot read that instance.

## Approaches considered

1. **Custom global Socket.IO adapter (selected):** Parse `FRONTEND_URLS` once in `main.ts`, use the resulting allowlist for HTTP CORS, pass it to a custom adapter, and apply Socket.IO CORS while creating its server. This centralizes deployment configuration and keeps gateway metadata static and environment-neutral.
2. **Adapter reads `ConfigService` itself:** This works but repeats origin parsing or requires another shared configuration abstraction.
3. **Mutate Socket.IO CORS in the gateway lifecycle:** This avoids a custom adapter but applies configuration after server creation and couples gateway initialization to transport internals.

## Design

- Add a small `IoAdapter` subclass for Socket.IO CORS configuration.
- Construct it in `main.ts` with the parsed `FRONTEND_URLS` allowlist, then register it with `app.useWebSocketAdapter(...)`.
- Configure HTTP and Socket.IO CORS from the same parsed origin list, with credentials enabled and the current handshake headers preserved where required.
- Remove the localhost origin from `NotificationsGateway` metadata so it cannot conflict with the deployment allowlist.
- Fail during application startup if `FRONTEND_URLS` is missing or parses to an empty list; do not use wildcard origins with credentials.
- Keep JWT authentication, room membership, notification events, and socket transport behavior unchanged.

## Scope

This is a small backend configuration change. It touches `src/main.ts`, the notifications gateway decorator, and adds the custom adapter plus focused coverage for configured origins and credentials. It does not change frontend socket connection behavior or add a separate WebSocket origin setting.

## Acceptance criteria

- HTTP and Socket.IO use the same configured frontend origin allowlist.
- No localhost origin is hard-coded in the gateway.
- Socket.IO CORS supports credentialed handshakes and rejects origins outside the allowlist.
- Missing/empty frontend origin configuration is reported at startup.
- Existing notification socket authentication and room behavior remain unchanged.
