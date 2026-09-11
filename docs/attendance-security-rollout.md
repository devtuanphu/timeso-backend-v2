# Attendance security rollout

Covers the changes that harden attendance, identity documents and OTP abuse.
No database migration is required. Two operational steps are, and one of them
is a staged rollout that must not be skipped.

## 1. Filesystem: identity documents

Identity scans (CCCD/ID) previously landed in `./uploads`, which
`ServeStaticModule` publishes at `/uploads` with **no authentication** — anyone
holding the URL could read them.

New uploads are written to `./uploads-private/identity` instead, which is not
served statically, and are read back through
`GET /api/accounts/identity/image/:filename`. That route requires a bearer token
and verifies the file belongs to the calling account.

Operational steps:

- [ ] Ensure the process can create and write `./uploads-private/` next to the
      existing `./uploads/`. It is created on first upload.
- [ ] Include `./uploads-private/` in backups, and exclude it from anything that
      serves files publicly (nginx aliases, CDN origins, object-storage sync).
- [ ] Documents uploaded by earlier builds keep their `/uploads/<uuid>` URL and
      keep loading. They are **still publicly readable**. To close that fully,
      move those files into `./uploads-private/identity/` and rewrite the
      matching `account_identity_documents.front_image_url` / `back_image_url`
      values to `/api/accounts/identity/image/<filename>`.
      `scripts/migrate_identity_documents_to_private.js` does exactly that. It
      is a dry run by default; pass `--apply` to make changes. It copies before
      it updates and deletes the public copy last, so an interrupted run never
      leaves a row pointing at a missing file, and it is safe to re-run.

## 2. Staged rollout: attendance policy enforcement

`StoreTimekeepingSetting.require_qr_scan` / `require_location` /
`attendance_radius` and `StoreShiftConfig.timekeeping_requirement` were
configurable but never read. QR was checked only when the client chose to send
`qrStoreId`, and GPS was recorded but explicitly never blocked.

Both booleans default to **true**, so switching enforcement on immediately makes
every store demand QR + location. Any employee on an app build that does not send
a location fix would be unable to check in. Enforcement is therefore gated by
`ATTENDANCE_ENFORCEMENT_MODE`:

| Value | Behaviour |
|---|---|
| unset / `off` (default) | Rules are evaluated and violations are logged; attendance still succeeds. |
| `enforce` | A violation rejects the attendance request. |

Any other value fails startup rather than silently disabling enforcement.

Rollout order:

- [ ] Deploy the backend with the variable unset. Nothing changes for clients.
- [ ] Ship the staff app build that sends `qrStoreId` and a GPS fix.
- [ ] Watch for `attendance policy not satisfied (mode=off, would reject)` in the
      logs. The message lists the rules that would have failed
      (`QR_REQUIRED`, `QR_MISMATCH`, `LOCATION_REQUIRED`, `OUT_OF_RANGE`).
- [ ] When that log line is rare enough, set `ATTENDANCE_ENFORCEMENT_MODE=enforce`
      and restart.

Employees listed in `location_exception_emp_ids` are never blocked on location,
in either mode.

## 3. OTP abuse limits

No configuration. Two limits are applied in `AuthService`:

- **Send limit** — at most 5 codes per account per 15 minutes, derived from
  `account_otps.created_at`. Durable and correct across processes.
- **Verify limit** — at most 10 failed verifications per account per 15 minutes.
  This one is **in-process**: with several PM2 workers an attacker gets the
  budget once per worker. It bounds what was previously an unlimited brute force
  against a six-digit code, and pairs with the send limit that caps how many live
  codes can exist. Moving it to Redis (already a dependency for BullMQ) is the
  natural follow-up.

Both respond `429` with code `TOO_MANY_REQUESTS`.

## 4. OTP codes at rest

`account_otps.otp` now holds an HMAC-SHA256 digest keyed from `JWT_SECRET` with a
fixed context label, not the six-digit code. The digest is 64 hex characters and
the column is a `varchar(255)`, so **no schema migration is required**.

Verification accepts a legacy plaintext row so codes issued by the previous build
stay usable, and that branch only accepts values shaped like a real code
(`^\\d{6}$`) — otherwise someone holding the stored digest could submit it
verbatim. Codes expire in 10 minutes, so the fallback in
`matchesStoredOtp` can be deleted any time after the deploy has settled.

Rotating `JWT_SECRET` invalidates every outstanding OTP, which is acceptable:
they are short-lived and a user can request a new one.

## 5. Refresh token growth

Every login used to insert a refresh-token row that was never revoked, and
`refreshToken` bcrypt-compares against **all** live rows for the account because
they are stored hashed. That scan grew without bound.

Issuing a token now revokes live rows beyond the 5 most recent per account and
app, and deletes already-expired rows for that account. Pruning failures are
logged and never fail a login.

## 6. Still open

- The verify-attempt limiter is per-process (see section 3).
- `stores.service.ts` remains a ~16k-line service; splitting it is a separate
  piece of work.

## 7. Staff job applications (separate feature)

`scripts/migration_add_job_applications.sql` creates `store_job_applications`
plus its enum type and indexes. It is idempotent and wrapped in a transaction.

- [ ] Run it before deploying the backend that contains `JobApplicationService`.

It deliberately adds **no** value to `notifications_type_enum`: job-application
notifications reuse the existing `SYSTEM` type and carry their destination in
`action_url` / `metadata.screen`. That avoids `ALTER TYPE ... ADD VALUE`, which
cannot run inside a transaction, and removes any deploy-ordering hazard between
the two apps and the API.

Abuse and privacy controls on this feature, for reference:

- **Apply rate limit** — 10 applications per account per hour, derived from
  `created_at` so it holds across processes. The per-(store, account) unique
  index already blocks repeat applications to one store; this bounds fan-out
  across many stores, which is what reaches owners' notification trays.
- **Applicant-authored text** — `full_name` is sanitised at the API boundary and
  again when a notification is composed. Newlines and control characters are
  folded or dropped and the name is capped at 60 characters, so an applicant
  cannot compose a push that renders as a fake multi-line system message.
- **Withdrawal** — `POST /stores/:storeId/job-applications/:id/withdraw` lets the
  applicant cancel a pending application. Contact details are cleared at once.
- **Retention** — `phone`, `email` and `introduction` are cleared immediately on
  rejection or withdrawal, and the daily
  `redact-stale-job-applications` cron (00:35 Asia/Ho_Chi_Minh, distributed
  lock, skipped in read-only mode) clears them on any reviewed application older
  than 90 days. The row, its decision and `full_name` are kept, so history and
  the unique-index behaviour survive. `contact_redacted_at` records when this
  happened; a partial index keeps the sweep cheap.
