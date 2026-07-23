# Timeso Backend Instructions

## Stack and structure

- NestJS 11, TypeScript, TypeORM/PostgreSQL, JWT/Passport, BullMQ, Socket.IO, schedules, Firebase Admin, mail, file handling, and face processing.
- Keep transport concerns in controllers and business rules in services.
- Define and validate external input with DTOs and `class-validator`.
- Keep shared entities and utilities in the established `src/common` boundaries; place domain behavior under the matching `src/modules/<domain>` module.
- Reuse existing dependency injection, exception, configuration, logging, and repository patterns before introducing new abstractions.

## Authentication and authorization

- Authentication never implies authorization.
- Authorize every protected action by account, role, store, and resource ownership as applicable.
- Do not trust client-provided account IDs, role IDs, store IDs, timestamps, location, attendance state, totals, or derived permissions.
- Apply equivalent authorization to HTTP endpoints, Socket.IO rooms/events, BullMQ jobs, scheduled tasks, file access, and notification targets.
- Avoid account enumeration in login, OTP, password reset, and outward error behavior.

## Data integrity

- Use transactions for related multi-step writes.
- Use database constraints and indexes for invariants that must survive concurrent requests.
- Make attendance, shift registration, queue jobs, scheduled operations, and notification dispatch idempotent where retries are possible.
- Handle duplicate requests, lost updates, stale versions, partial failure, and cross-midnight Asia/Ho_Chi_Minh behavior explicitly.
- Avoid unbounded reads, N+1 queries, and accidental sensitive relation exposure.
- Keep migrations backward compatible with released mobile clients; prefer additive API and schema rollout.

## Sensitive data and production safety

- Treat passwords, OTPs, JWTs, service credentials, face images or embeddings, location, salary, attendance, employee records, uploads, and private notifications as sensitive.
- Never include sensitive values in logs, stack traces, test snapshots, push payloads, committed fixtures, or assistant output.
- Validate file type, size, path, content expectations, retention, and deletion behavior.
- Bound retries, payload sizes, batch sizes, pagination, and expensive AI/face-processing work.
- Do not expose Swagger, debug routes, stack traces, environment details, or development CORS behavior unintentionally in production.

## Testing and verification

- Run `npm run build` for implementation changes.
- The current `npm run lint` includes `--fix`; use a non-fixing ESLint command for review and diagnostic checks.
- Run targeted Jest unit tests and relevant `npm run test:e2e` Supertest coverage.
- Add E2E tests for validation, missing/invalid/expired tokens, wrong roles, cross-store access, duplicate requests, concurrency-sensitive writes, and stable error contracts.
- Test BullMQ retry/idempotency and unauthorized Socket.IO access when those paths change.

## Dependency and environment safety

- Do not expose or commit `.env`, Firebase service accounts, database credentials, mail credentials, uploaded private data, model artifacts, or generated production output.
- Do not change dependencies or lockfiles incidentally. Confirm the active package-manager workflow first.
- Do not run destructive database migrations, seeds, cleanup scripts, or production-connected commands without explicit authorization and verified target environment.

## Review focus

Prioritize authorization bypass, store isolation, data leakage, transaction boundaries, race conditions, idempotency, API compatibility with both mobile apps, queue/socket parity, validation, resource exhaustion, and missing E2E coverage.
