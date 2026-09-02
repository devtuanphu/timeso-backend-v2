# Chat Reliability V2 test evidence

These artifacts never target a database unless both guards pass:

- `TIMESO_ISOLATED_DB=true`
- `TIMESO_TEST_DATABASE_URL` names a database ending exactly in `_test`

Every PostgreSQL suite creates a randomized `chat_e2e_<uuid>` schema and drops
only that exact owned schema during cleanup. It never drops a database or the
`public` schema. Use a resettable local/CI database only.

## PostgreSQL and Supertest

```bash
TIMESO_ISOLATED_DB=true \
TIMESO_TEST_DATABASE_URL='postgres://.../timeso_chat_test' \
npm run test:e2e -- --runInBand \
  test/chat-message-command.pg-e2e-spec.ts \
  test/chat-outbox-singleton.pg-e2e-spec.ts
```

Build first because the guarded harness starts the compiled application:

```bash
npm run build
```

The command spec boots the real `AppModule` and exercises the production JWT
strategy, HTTP/runtime guards, controller, authorization, durable command, and
query services. It covers durable send/idempotency/concurrency/rollback plus
history, catch-up, monotonic reads, wildcard-safe search, unread aggregation,
and current cross-store/employment/membership/account authorization.

The outbox/singleton spec invokes the production dispatcher, authorization,
readiness, local publisher, and PostgreSQL advisory-lock guard. Only the Socket.IO
server/network boundary is replaced with a capture seam. Both suites are skipped
before setup when either database guard is missing.

## Migration rehearsal

The rehearsal additionally requires `psql` on `PATH` and an explicit third
gate. Concurrent indexes run through psql autocommit.

```bash
TIMESO_ISOLATED_DB=true \
TIMESO_RUN_CHAT_MIGRATION_REHEARSAL=true \
TIMESO_TEST_DATABASE_URL='postgres://.../timeso_chat_test' \
npm run test:e2e -- --runInBand test/chat-migration-rehearsal.pg-e2e-spec.ts
```

## Live Socket.IO gateway

The backend intentionally has no `socket.io-client` production dependency.
This artifact loads the already-approved client module only when explicitly
enabled. Point `TIMESO_SOCKET_IO_CLIENT_MODULE` at an installed Socket.IO v4
client module in the isolated CI workspace; do not install it into the backend
as an implicit test step.

```bash
TIMESO_RUN_CHAT_SOCKET_E2E=true \
TIMESO_SOCKET_IO_CLIENT_MODULE='/absolute/isolated/node_modules/socket.io-client' \
npm run test:e2e -- --runInBand test/chat-socket.integration-e2e-spec.ts
```

JWT secrets and token fixtures in that suite are inline test-only constants.
No environment file, account credential, token, or production identifier is
required or written.

## Cross-app Maestro fixture

Run only from `timeso_owner` after building the backend and installing the two
apps on the selected simulators/emulators:

```bash
TIMESO_ISOLATED_DB=true \
TIMESO_TEST_DATABASE_URL='postgres://.../timeso_chat_test' \
node e2e/scripts/run-chat-reliability.mjs --platform ios
```

The runner accepts no API URL, group ID, account token, message, or credential.
It reserves a random owned schema/run tag, starts a loopback backend in that
schema, seeds tagged store/group/accounts, verifies the ownership marker and
exact tags before each flow/assertion, and tears down only that schema in a
`finally` block. It also starts clean owner/staff development-client Metro
bundles on fixed ports `18081`/`18082`, injects the exact owned backend origin,
checks each repository app ID/scheme, and opens each installed client against
its own bundle before Maestro. Android uses `--platform android --device
emulator-5554` and the emulator-safe `10.0.2.2` host. Tokens and credentials
exist only in child-process runtime.
