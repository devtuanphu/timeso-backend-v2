# Chat Reliability V2 operator handoff

Before deploying the token discriminator, configure distinct non-empty
`JWT_SECRET` and `JWT_REFRESH_SECRET` values through the environment's secret
manager. Do not place either value in this repository.

For the approved transition only, operators may configure absolute RFC3339
`JWT_LEGACY_UNTYPED_WINDOW_STARTED_AT` and
`JWT_LEGACY_UNTYPED_CUTOFF_AT` timestamps. The cutoff must be after the start
and no more than seven days later. Missing or expired values disable legacy
untyped tokens. Untyped access compatibility additionally requires the strict
`JWT_LEGACY_UNTYPED_ACCESS_ATTESTED=true` operator gate. Set it only after
retaining deployment evidence that every still-valid historical refresh token
was signed with a refresh key distinct from the access key. Without that
attestation, untyped access tokens are rejected and users must sign in again.
Do not record key material in the attestation evidence. All newly issued tokens include `tokenUse`; after cutoff,
clients holding older tokens must sign in again.

Database rollout order is preflight, expand, concurrent indexes, bounded freeze
driver, backfill, verify, contract preparation, bounded validation, then
contract. Run preflight, preparation, validation, and contract with `psql`; each
artifact enables `ON_ERROR_STOP` itself so any raised safety exception returns a
non-zero process status and stops automation immediately. Each phase has bounded lock and
statement timeouts; after a timeout or ambiguous disconnect, rerun that entire
phase before advancing. Contract fails closed unless the sequence-positive and
read-cursor proofs are validated and, when the sequence column is still
nullable, its non-null proof is validated. If contract already set the column
NOT NULL and dropped the temporary proof before the connection was lost, a
retry accepts that already-contracted state and conditionally drops the proof.
Run each artifact only against the explicitly approved target; no script in
this directory is self-deploying.

The preflight is intentionally safe on the legacy schema before `sequence` is
added. Its optional duplicate-sequence check resolves the `chat_messages` table
from the active target `search_path` and runs only when that exact table already
has the additive column; similarly named tables in other schemas do not enable
the check.
