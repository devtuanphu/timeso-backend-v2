# Chat push delivery rollout

This is an additive, migration-first rollout. It does not create notification-center
records and does not backfill old chat messages.

1. Take/verify the target backup or forward-fix path and run the aggregate-only
   `migration_chat_push_delivery_preflight.sql`.
2. Apply `migration_chat_push_delivery_expand.sql` while chat push remains disabled.
   The changes add nullable columns and new tables/indexes; no existing token is copied
   into the fingerprint column. Run the file with psql autocommit enabled; its
   `CREATE INDEX CONCURRENTLY` phases must not be wrapped in a transaction. The script
   uses bounded lock and statement timeouts and validates new source-table checks after
   adding them as `NOT VALID`.
3. Deploy the backend with `CHAT_PUSH_DELIVERY_ENABLED=false` (the default). Deploy the
   Owner and Staff clients so authenticated devices re-register and receive a fingerprint/version.
4. Verify `verify_chat_push_delivery.sql`. Re-enrollment is intentionally gradual;
   legacy rows with a null fingerprint remain eligible for existing notification types
   but not chat push.
5. Set `CHAT_PUSH_ACTIVATION_STARTED_AT` to a new timezone-qualified RFC3339 timestamp,
   then enable `CHAT_PUSH_DELIVERY_ENABLED=true` on the one writable singleton chat
   instance. Messages accepted before that timestamp are never enrolled.

If push delivery must be stopped, disable the flag. Socket publication and accepted chat
messages continue independently. Pending delivery rows can be resumed after a forward
fix. Do not replay old outbox rows administratively; the activation cutoff is the safety
barrier.

The ledger prevents deliberate retries after Expo accepts a ticket. A transport timeout
after Expo received a request but before the backend persisted its ticket is inherently
ambiguous, so the system does not claim exactly-once visual delivery for that failure
window.

Within one live dispatcher process, accepted tickets are retained before the first
database write. Persistence is retried before any new batch is claimed; retained
acknowledgements are never evicted or deliberately resent. The batch bounds this
recovery buffer to five entries. A missing delivery, changed claim/status, or a
different durable ticket latches `CHAT_PUSH_ACK_RECONCILIATION_REQUIRED` once and
stops new claims. `getRecoveryStatus()` exposes the retained count and latch to
in-process diagnostics. This is not currently an HTTP health endpoint. Alert on the
stable log code and reconcile database/provider evidence before restarting: restart
alone discards the in-memory evidence and does not repair the ambiguity.

Device registration and owned logout share sorted device/token transaction locks.
The business operation has one 12-second monotonic budget, including connection
acquisition and each ORM SQL statement. Exhaustion returns HTTP 503
`DEVICE_BINDING_BUSY`; rollback/release are best-effort cleanup outside that budget.
Clients bound registration and logout independently so a stalled request cannot
prevent local sign-out.

Staff now requires native `expo-notifications` and `expo-secure-store`. Build the
new 12.0.9 runtime (iOS build 7); do not send this JavaScript to 12.0.8 via OTA.
Simulator tests cannot establish real Expo/APNs delivery. Verify permission denial,
foreground/background/cold-start taps and account switching on a physical device
before activation. Protected-install capability/stale-registration replay hardening
is still pending its separate account-transfer decision; this document is not a
release approval.

Terminal delivery rows may be removed in bounded batches after 14 days when their
source push intent is terminal or its independently retained outbox row has already
expired. The per-message/device and per-message/token ledger keys remain the retry
barrier while the delivery exists; the activation cutoff prevents administrative
historical replay after normal retention removes both source and terminal ledger rows.
Never delete `pending`, `processing`, or
`ticket_accepted` rows. Source socket outbox retention remains 24 hours for published
and 7 days for dead rows, and cleanup must preserve events with a nonterminal push
intent.

Provider logs and application logs must contain aggregate counts/error codes only—never
raw tokens, message text, sender, group, or store names.
