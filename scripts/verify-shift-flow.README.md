# verify-shift-flow

Smoke test for the shift lifecycle that spans **timeso_owner** (owner app) and
**timeso-staff** (staff app), all hitting this backend. It drives the real REST
API the two apps use and asserts the status transitions line up.

## What it checks

| Step | Actor | Endpoint | Expected |
|------|-------|----------|----------|
| 1 | owner | `POST /stores/:id/work-shifts` | shift template created |
| 2 | owner | `POST /stores/:id/work-cycles` | ACTIVE cycle + 1 slot |
| 3 | staff | `POST /stores/shift-slots/:slotId/register` (`isOwnerAssign:false`) | assignment → `PENDING` |
| 4 | owner | `PUT /stores/shift-assignments/:id/status` (`status:APPROVED`) | assignment → `APPROVED` |
| 5 | staff | `POST /stores/shift-assignments/:id/check-in` | → `CONFIRMED` * |
| 6 | staff | `POST /stores/shift-assignments/:id/check-out` | → `COMPLETED`, `shiftEarnings` set * |
| 7 | owner | `POST /stores/:id/payrolls/generate` | payroll aggregates the month |

\* Check-in/out require a **registered face** and a **photo the face engine can
read**. On a normal run these are reported **SKIPPED** (they are on-device steps).
The script still verifies the assignment reached `APPROVED`, which is the exact
precondition the backend's check-in handler enforces
(`status === 'APPROVED'`, otherwise it throws "Ca làm việc chưa được chấp thuận").

## Status-chain verification (from code)

The enum is `PENDING → APPROVED → CONFIRMED → COMPLETED` (+ `CANCELLED`). Confirmed
the apps agree with it:

- Owner approves with `status: 'APPROVED'` (`timeso_owner/src/services/api/store.ts`),
  and owner direct-assign sends `isOwnerAssign:true` → lands at `APPROVED`.
- Staff self-register sends `isOwnerAssign:false` → `PENDING`
  (`timeso-staff/src/services/api/workshift.ts`).
- Nothing sends `'CONFIRMED'` to the status endpoint (which would break check-in).
  There is one **dead** type `UpdateAssignmentStatusRequest` in
  `timeso_owner/.../work-shift.types.ts` that still names `CONFIRMED` — unused, but
  worth deleting so nobody wires it up by mistake.
- Check-out computes `shiftEarnings` from the active contract; payroll generation
  prefers those realized per-shift earnings (`hasShiftEarnings`) and otherwise
  estimates from `completedShifts`/`workingHours`.

## Safety

Writes real rows (cycle, slot, assignment, payroll). **Do not point at a shared /
production DB.** The script refuses to run without
`--i-understand-this-writes-data`, and best-effort stops the cycle it created on
exit (disable with `--no-cleanup`).

## Run

```bash
BASE_URL=http://localhost:3000/api \
OWNER_LOGIN=owner@example.com OWNER_PASSWORD=secret \
STAFF_LOGIN=staff@example.com STAFF_PASSWORD=secret \
STORE_ID=<storeId> STAFF_PROFILE_ID=<employeeProfileId> \
node scripts/verify-shift-flow.mjs --i-understand-this-writes-data
```

Attempt attendance too (needs photos):

```bash
... FACE_PHOTOS=a.jpg,b.jpg,c.jpg CHECKIN_PHOTO=face.jpg \
node scripts/verify-shift-flow.mjs --i-understand-this-writes-data --with-attendance
```

Exit code is non-zero if any step FAILs. Requires Node 18+ (global `fetch`/`FormData`).
