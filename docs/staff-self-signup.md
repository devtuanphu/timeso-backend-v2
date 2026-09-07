# Staff self-sign-up and owner attachment

This note records the approved implementation contract for the cross-app staff onboarding flow.

## API contract

- `POST /auth/register` creates only an unverified account and registration OTP. It returns `phone`, `verificationRequired: true`, and `otpDelivery: sent | failed`. Zalo delivery happens after the database transaction commits.
- `POST /auth/resend-otp` persists the replacement OTP before Zalo delivery and returns the same delivery status.
- `POST /auth/verify-otp` checks the newest unused OTP. Registration verification activates the account and returns the existing login token shape. Omitted `appType` remains owner-compatible; the staff app sends `EMPLOYEE_APP`.
- `GET /stores/discovery` is authenticated, read-only, paginated, and available only to active accounts without a non-terminated employee assignment. It returns only store id, name, display address, and avatar.
- `GET /stores/:id/employee-account-candidate` performs an exact normalized-phone lookup for the store owner and returns one generic ineligible response for all failure states.
- `POST /stores/:id/employees/from-account` attaches an eligible existing account. The legacy account-id endpoint remains compatible and uses the same authorization and invariant checks.

## Persistent invariants

- New email and Vietnamese phone identifiers are canonicalized; legacy values remain readable.
- Registration locks canonical identifier keys in stable order. OTP verification and account attachment lock the account row.
- Staff self-registration never creates `EmployeeProfile`.
- Existing-account attachment never overwrites account identity, contact, finance, or password fields.
- Profile, optional contract, monthly summary, payroll, salary, and initial assets are initialized atomically. Asset ids are deduplicated and locked in sorted order before stock decrement.
- Store discovery never creates membership. The owner attachment action is the only transition in this flow.

## Mobile behavior

- The staff app preserves unverified login state, supports Zalo delivery failure/resend, and routes verified staff without a store to discovery.
- Discovery ignores queries shorter than two characters, debounces requests, rejects stale responses, and provides retry, pagination, membership refresh, and logout.
- The owner app keeps the existing candidate/manual choices and adds a third existing-account path that reuses manual work and contract configuration.

No database schema, dependency, native project, environment, migration, or production rollout change is part of this implementation.

## Delivery workflow and verification evidence

The `timeso-deliver-feature` workflow selected requirement review, cross-system
analysis, implementation planning, independent plan review, one implementation
writer, backend/mobile/security review, isolated PostgreSQL E2E, and native
Maestro gates. Three user-authorized repair cycles addressed blocked-account OTP
activation, restore/attach and payroll races, legacy identifier collisions,
malformed auth inputs, stale/double-submit mobile interactions, owner success
navigation, complete failed-delivery UI coverage, and an owned native-to-real-
Nest test bridge.

The bridge is test-only. Native requests go to a proxy bound to
`127.0.0.1:14321`, which forwards an explicit core-route allowlist to a real
Nest test application on `127.0.0.1:14322`. That application uses real auth,
account and store controllers/services/guards against a unique
`timeso_signup_<run-id-hash>` schema in the isolated loopback `_test` database.
Each schema has a random process-only ownership token; collision fails before
TypeORM initialization and cleanup verifies ownership before dropping only that
schema. OTP `123456` and the recording Zalo provider exist only in this test
factory.

| Workflow stage | Responsible agent/gate | Final result |
| --- | --- | --- |
| Requirement review | requirement analyst | Ready |
| Cross-system analysis | system analyst | Ready |
| Implementation plan | implementation planner | Ready |
| Plan review | independent plan reviewer | Approved |
| Implementation and repairs | single implementation writer | Complete |
| Backend review | backend reviewer | Approved after repairs |
| Mobile review | mobile reviewer | Approved after repairs |
| Security review | security reviewer | Approved |
| Test/fixture review | test reviewer | Approved after coverage and harness repairs |

Observed checks on the current artifact:

- Backend focused Jest: 4 suites, 31 tests passed.
- Backend isolated PostgreSQL Supertest: 1 suite, 17 tests passed against
  `127.0.0.1:32801/timeso_staff_signup_test` with explicit
  dual opt-in protection. The cases assert a complete valid
  role/type/shift/skill/contract/salary/asset attachment without identity
  mutation, stable minimal pagination excluding inactive/deleted stores, real
  `/accounts/employee-stores`, owner isolation for lookup and mutation,
  concurrency/rollback invariants, and exclusive schema ownership/cleanup.
- Non-fixing ESLint passed for the three backend bridge files.
- Backend `yarn build`: passed.
- Staff focused Jest: 7 suites, 25 tests passed. These include failed OTP
  delivery/resend, unverified-login recovery without token persistence,
  discovery retry/pagination/membership/logout, and root empty-vs-network
  routing. `RegisterScreen.test.tsx` now exercises the complete
  `otpDelivery: failed` registration response through the visible Zalo OTP
  modal, real resend service invocation, and updated sent state.
- Owner focused Jest: 4 suites, 15 tests passed. Existing-account success now
  performs one replace without cancel/back navigation and does not claim that a
  notification was sent.
- Owner `npx tsc --noEmit`: passed.
- Non-fixing affected-file ESLint passed for staff and owner with warnings;
  backend reported the same five pre-existing `stores` errors independently
  verified against baseline.
- Targeted Prettier checks reported existing/style drift in 10 backend, 9
  staff, and 4 owner files. No formatter was run because whole-file formatting
  of the large legacy services would create unrelated churn.
- Fixture/runner Node tests: 8 passed. They cover loopback-only Nest origin,
  faithful core-route forwarding, strict rejection of unknown writes, merged
  database-derived status, exact reserved ports, iOS/Android origin mapping,
  Expo Router test-file hygiene, and refusal of a busy foreign port without
  terminating its listener, exact APK Metro resource parsing, and a defined
  ExpoCrypto class check. `node --check` passed for every changed runner and
  fixture module.
- A direct full bridge probe performed register, OTP verify, discovery, owner
  login, candidate lookup, atomic attach and staff membership refresh through
  the proxy and real Nest/PG services. It observed exact counters of one for
  register/verify/discovery/candidate/attach/membership and passed 20 sanitized
  database assertions covering identity, active profile, selected references,
  contract, summary, payroll, salary, assets, Zalo stub and store responses.
  The status endpoint exposes only the run id, states, counts and booleans; it
  does not expose tokens, OTP, password/hash, raw references or contract values.
- Full staff `npx tsc --noEmit` remains blocked by pre-existing Jest-global,
  socket-test, KPI demo, and date-picker type errors; the changed staff files
  produced no matches in a filtered TypeScript check.

Native status at this checkpoint:

- Android API 35 is the required native gate. The coordinator built and
  installed both current debug APKs on `emulator-5580`. Source and installed
  hashes matched (`staff 491967a4...afa13`, `owner c270b1ac...581f361`), packaged
  Metro ports were `18082` and `18081`, and both APKs contained ExpoCrypto.
  Staff required the existing-project command-line Kotlin/KSP compatibility
  overrides shown below; no native file or dependency was changed.
- The saved owner standalone flow passed candidate lookup for the exact
  `Nhan vien E2E` identity, role/shift selection, default contract submission,
  success navigation, and all authoritative database assertions.
- The final saved Android cross-app runner exited `0`. It observed all three
  Maestro flows pass: staff register with fixed test OTP, login and accentless
  store discovery; owner exact candidate lookup, role/shift/default contract
  attach and success; then staff state resume, explicit membership refresh,
  discovery exit and the positive `Chưa đăng ký khuôn mặt` destination. The
  runner's intermediate/final PostgreSQL assertions passed, all four owned
  ports were released, and no `timeso_signup_%` schema remained after cleanup.
  Earlier checkpoint failures were limited to harness mechanics (APK analyzer
  output buffering, cold dev-client launch timing, and keyboards covering
  footer actions); the saved parsers and Maestro flows were repaired and the
  complete runner was rerun successfully.
- The final screenshot at
  `/tmp/timeso-staff-native-final-membership.png` shows the newly attached staff
  on Home with the existing face-registration modal. A development LogBox then
  reports fixture 404 responses for unrelated, deliberately unmocked Staff Home
  bootstrap GETs. This is not a signup, attachment or membership failure;
  biometric capture and the remaining Home features were not part of the
  verified gate. Maestro artifacts are retained under
  `/tmp/timeso-staff-owner-93322-staff-signup`,
  `/tmp/timeso-staff-owner-93322-owner-attach`, and
  `/tmp/timeso-staff-owner-93322-staff-refresh`.
- Staff iOS cannot be installed on the available arm64 simulator because the
  existing MLKit pods exclude arm64 simulator; changing pods/native projects is
  outside this feature.
- The cross runner requires free task ports `14321`, `14322`, `18081`, and
  `18082`; it never preflights or kills `8081`. It verifies run ownership,
  Metro app/API identity and staff APK provenance before UI actions, then stops
  only its Metro, proxy and Nest children. Nest performs guarded schema cleanup.

Commands observed for the repaired artifact:

```sh
# timeso-backend-v2
yarn jest src/common/utils/account-identifier.spec.ts src/modules/auth/auth-registration.spec.ts src/modules/stores/stores-staff-onboarding.spec.ts src/modules/auth/auth-read-only.spec.ts --runInBand
TIMESO_STAFF_SIGNUP_NEST_E2E=true TIMESO_ISOLATED_DB=true PGHOST=127.0.0.1 PGPORT=32801 PGUSER=postgres PGDATABASE=timeso_staff_signup_test yarn jest --config test/jest-e2e.json test/staff-self-signup.e2e-spec.ts --runInBand
npx eslint test/support/staff-self-signup-test-app.ts test/fixtures/run-staff-signup-nest.ts test/staff-self-signup.e2e-spec.ts
yarn build

# timeso-staff
npx jest src/services/api/auth.test.ts src/services/api/store.test.ts src/features/authentication/screens/RegisterScreen.test.tsx src/features/authentication/screens/LoginScreen.test.tsx src/features/authentication/components/OTPModal.test.tsx src/features/store/screens/StoreDiscoveryScreen.test.tsx src/__tests__/app-index.test.tsx --runInBand
node --test e2e/scripts/staff-signup-runner-utils.test.mjs e2e/scripts/staff-signup-fixture-server.test.mjs

# Abridged core build flags observed; the coordinator also supplied its Java 21,
# arm64-v8a, worker-limit and EXPO_NO_DOTENV process flags.
cd android
./gradlew :app:assembleDebug -PreactNativeDevServerPort=18082 -PkotlinVersion=2.1.20 -PkspVersion=2.1.20-2.0.1 -Pandroid.kotlinVersion=2.1.20

# timeso_owner Android existing project, abridged core flag
cd ../../timeso_owner/android
./gradlew :app:assembleDebug -PreactNativeDevServerPort=18081

# timeso_owner
npx jest src/services/api/__tests__/store.test.ts src/features/employee/screens/__tests__/AddEmployeeScreen.test.ts src/features/employee/components/__tests__/ManualAddForm.test.ts src/features/employee/screens/__tests__/AddEmployeeSuccessScreen.test.ts --runInBand
npx tsc --noEmit

# isolated Android native-to-real-Nest cross-app runner (observed exit 0)
TIMESO_E2E_PLATFORM=android \
STAFF_MAESTRO_DEVICE_ID=emulator-5580 \
OWNER_MAESTRO_DEVICE_ID=emulator-5580 \
TIMESO_STAFF_ANDROID_APK=<verified-staff-app-debug.apk> \
TIMESO_STAFF_SIGNUP_NEST_E2E=true TIMESO_ISOLATED_DB=true \
PGHOST=127.0.0.1 PGPORT=32801 PGUSER=postgres \
PGDATABASE=timeso_staff_signup_test \
node e2e/scripts/run-staff-owner-onboarding.mjs
```

No migration, shared/production seed, dependency change, environment-file edit,
deployment, production access, Git push, or live Zalo delivery was performed.
Isolated per-run test fixtures were created and removed by the guarded harness. OTP storage
hashing and durable provider throttling/cooldown remain separate hardening work
because they require schema or infrastructure decisions outside this scope.
