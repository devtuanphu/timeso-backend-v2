# Decomposing `StoresService`

## The measurement

`src/modules/stores/stores.service.ts` is **16,489 lines** with roughly **345
methods** and about **146 constructor dependencies**. `stores.controller.ts` is
~4,400 lines and carries **297 of the backend's 362 HTTP routes**. Both are
reached from `StoresController`, `StoresPublicController`, `StoresCronService`,
`AuthService`, and three BullMQ processors.

Method counts by domain keyword, as a rough mass distribution:

| Domain | Methods | Domain | Methods |
|---|---|---|---|
| Employee | 61 | Asset | 21 |
| Shift | 36 | Payroll | 17 |
| Salary | 33 | Product | 16 |
| Report | 29 | Contract | 9 |
| KPI | 25 | Order / Leave / Stock / Inventory / Feedback | ≤6 each |

## Why this matters beyond tidiness

The authorization gaps found in this codebase track the module boundary almost
exactly. The subsystems that were built as their own services —
`ShiftAggregationService`, `ShiftEndWorkflowService`, `ShiftReminderService`,
and the whole `chat-groups` module — consistently take an `accountId`, call an
assertion helper, and have concurrency tests. The bulk that stayed inside
`StoresService` largely does not: only 72 of the 297 routes on
`stores.controller.ts` bind `@GetUser` at all.

A 146-dependency constructor also makes every unit test either a giant fixture
or a hand-built prototype object. Two of the specs in this repository were
silently exercising a failure path for exactly that reason (an empty
`DataSource` mock made `findOrCreateMonthlyPayroll` throw, and the caller
swallowed it).

So the decomposition is not cosmetic: it is the mechanism that makes
"every write is authorized" checkable.

## Sequencing

Extract in order of *risk carried*, not size, and treat each step as its own
change with its own review. A step is done when the new service owns its
repositories, takes `accountId` on every mutating method, and has a spec.

1. **Attendance** — `checkInWithFace`, `checkOutWithFace`, `registerFace`,
   `recordCheckoutMood`, `getAttendanceLogs`, `appendToDailyReport`.
   Already the best-covered area (48 unit tests plus 7 e2e, including
   concurrency), and the pure pieces are extracted:
   `attendance-time.utils.ts`, `attendance-enforcement.ts`. This is the safest
   first move and the template for the rest.
   `appendToDailyReport` was a read-modify-write over a JSONB array that lost
   updates under concurrent check-ins; it is now a single conditional `UPDATE`
   with a `NOT @>` guard, so it is atomic and idempotent. That removes the one
   concurrency blocker in this area.

2. **Payroll & salary** — ~50 methods around `MonthlyPayroll`,
   `EmployeeSalary`, `EmployeeMonthlySummary`, `SalaryAdjustment`,
   `SalaryAdvanceRequest`, plus the `SALARY INQUIRIES` and `SALARY SLIP DATA`
   sections. Highest financial risk, and the read endpoints
   (`GET /stores/:id/employee-salaries`, `GET /stores/employees/:profileId/salaries`,
   `GET /stores/employee-salaries/:salaryId`) are among the unscoped ones.
   `findOrCreateMonthlyPayroll` already holds a per-(store, month) advisory
   lock — keep that boundary intact.

3. **Requests** — leave, shift-change, bonus-work, approvals. Small, cohesive,
   and the mass-assignment fix already landed here, so the shape is known.

4. **Inventory** — assets, products, stock transactions, export types,
   inventory reports. Large but low coupling to the rest.

5. **KPI** — types, units, periods, tasks, employee KPIs, approval requests.

6. **Reporting** — the ~29 report methods. Read-only, so it can move late; they
   mostly need `assertStoreRevenueReportAccess` applied consistently.

Store settings and employee-profile CRUD stay in `StoresService`, which ends up
as the store/tenant aggregate the others depend on.

## Rules that make the split safe

- **Move, do not rewrite.** Each step is a relocation plus the authorization
  argument. Behaviour changes belong in separate commits.
- **Controller split follows the service split**, so `stores.controller.ts`
  shrinks in the same steps and the `@Get(':id')` ordering hazard at line ~814
  stops growing. Every literal route registered after it survives only because
  it has two or more segments; a future single-segment route added below it is
  silently shadowed.
- **Add the authorization argument during the move.** The point is to make an
  unauthorized method impossible to write, not to preserve the current
  signatures.
- **Characterisation tests first** for any area without them. Payroll and
  inventory need this; attendance already has it.
- **One writer at a time.** These files are large enough that concurrent edits
  will conflict badly.

## The alternative worth considering

A guard-based fix — a `StoreAccessGuard` resolving `:id`/`:storeId` and checking
membership, applied at the controller class level — closes the authorization
gap across all 297 routes far faster than decomposition, without moving any
code. It does not fix testability or the God object, but it is the right
*first* move if the priority is closing the IDOR surface rather than
restructuring. The two are complementary: the guard buys time, the split makes
the property durable.
