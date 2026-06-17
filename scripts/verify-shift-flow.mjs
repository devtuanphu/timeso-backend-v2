#!/usr/bin/env node
/**
 * verify-shift-flow.mjs
 * ---------------------------------------------------------------------------
 * End-to-end smoke test for the shift lifecycle that spans the owner app and
 * the staff app, all hitting the same backend:
 *
 *   1. (owner)  create a work-shift template
 *   2. (owner)  create an ACTIVE work-cycle with one slot for that shift
 *   3. (staff)  employee self-registers to the slot          -> PENDING
 *   4. (owner)  approve the registration                     -> APPROVED
 *   5. (staff)  check-in                                     -> CONFIRMED  *
 *   6. (staff)  check-out                                    -> COMPLETED  *
 *   7. (owner)  generate payroll and read it back
 *
 *   * Steps 5-6 require a registered face + a photo the face engine can read.
 *     They are ATTEMPTED only when --with-attendance is passed together with
 *     CHECKIN_PHOTO / FACE_PHOTOS env vars; otherwise they are reported as
 *     SKIPPED (manual / on-device step) and the script still verifies that the
 *     assignment reached APPROVED, which is the precondition check-in needs.
 *
 * SAFETY
 *   This writes real rows (cycle, slot, assignment, payroll). NEVER point it at
 *   a production / shared database. It refuses to run unless you pass
 *   --i-understand-this-writes-data. It also tries to clean up the cycle it
 *   created at the end (best effort) unless --no-cleanup is given.
 *
 * USAGE
 *   BASE_URL=http://localhost:3000/api \
 *   OWNER_LOGIN=owner@example.com OWNER_PASSWORD=secret \
 *   STAFF_LOGIN=staff@example.com STAFF_PASSWORD=secret \
 *   STORE_ID=<storeId> STAFF_PROFILE_ID=<employeeProfileId> \
 *   node scripts/verify-shift-flow.mjs --i-understand-this-writes-data
 *
 *   Optional:
 *     --with-attendance         attempt check-in/out (needs photos, see below)
 *     --no-cleanup              keep the created cycle/slot/assignment
 *     CHECKIN_PHOTO=/path.jpg   single photo used for check-in & check-out
 *     FACE_PHOTOS=a.jpg,b.jpg,c.jpg   >=3 photos to register the staff face first
 *     WORK_DATE=YYYY-MM-DD      slot date (default: today)
 *
 * No external deps: uses Node 18+ global fetch + FormData + Blob.
 */

import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const args = new Set(process.argv.slice(2));
const env = process.env;

const BASE_URL = (env.BASE_URL || 'http://localhost:3000/api').replace(/\/$/, '');
const WITH_ATTENDANCE = args.has('--with-attendance');
const CLEANUP = !args.has('--no-cleanup');

const log = (...a) => console.log(...a);
const ok = (m) => log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => log(`  \x1b[31m✗\x1b[0m ${m}`);
const info = (m) => log(`  \x1b[36mi\x1b[0m ${m}`);
const step = (n, m) => log(`\n\x1b[1m[${n}] ${m}\x1b[0m`);

function requireEnv(keys) {
  const missing = keys.filter((k) => !env[k]);
  if (missing.length) {
    bad(`Missing required env vars: ${missing.join(', ')}`);
    process.exit(2);
  }
}

if (!args.has('--i-understand-this-writes-data')) {
  log(
    '\nThis script writes real data (cycle, slot, assignment, payroll).\n' +
      'Point it ONLY at a local/dev backend, then re-run with:\n' +
      '  --i-understand-this-writes-data\n',
  );
  process.exit(1);
}

requireEnv([
  'OWNER_LOGIN',
  'OWNER_PASSWORD',
  'STORE_ID',
  'STAFF_PROFILE_ID',
]);

const STORE_ID = env.STORE_ID;
const STAFF_PROFILE_ID = env.STAFF_PROFILE_ID;
const WORK_DATE = env.WORK_DATE || new Date().toISOString().slice(0, 10);

// ── tiny HTTP helper ───────────────────────────────────────────────────────
async function api(method, path, { token, json, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (form) {
    body = form; // FormData sets its own content-type
  }
  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = data?.message || data || res.statusText;
    const err = new Error(
      `${method} ${path} -> ${res.status}: ${
        Array.isArray(msg) ? msg.join('; ') : msg
      }`,
    );
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function login(emailOrPhone, password, appType) {
  const data = await api('POST', '/auth/login', {
    json: { emailOrPhone, password, appType },
  });
  const token = data?.accessToken || data?.access_token || data?.token;
  if (!token) throw new Error('Login succeeded but no access token in response');
  return token;
}

function fileToBlob(path) {
  const buf = readFileSync(path);
  return { blob: new Blob([buf], { type: 'image/jpeg' }), name: basename(path) };
}

// ── flow ─────────────────────────────────────────────────────────────────
let createdCycleId = null;
let ownerToken = null;
const results = [];
const record = (name, status, detail) => results.push({ name, status, detail });

async function main() {
  log(`\nBASE_URL = ${BASE_URL}`);
  log(`STORE_ID = ${STORE_ID}`);
  log(`WORK_DATE = ${WORK_DATE}`);

  // 0. Auth
  step(0, 'Authenticate');
  ownerToken = await login(env.OWNER_LOGIN, env.OWNER_PASSWORD, 'OWNER_APP');
  ok('Owner logged in');
  let staffToken = null;
  if (env.STAFF_LOGIN && env.STAFF_PASSWORD) {
    const staffData = await api('POST', '/auth/login', {
      json: {
        emailOrPhone: env.STAFF_LOGIN,
        password: env.STAFF_PASSWORD,
        appType: 'EMPLOYEE_APP',
      },
    });
    staffToken = staffData?.access_token || staffData?.accessToken || staffData?.token;
    if (!staffToken) throw new Error('Staff login returned no access token');
    const profileFromLogin = staffData?.user?.employeeProfileId;
    if (profileFromLogin && profileFromLogin !== STAFF_PROFILE_ID) {
      info(`note: login profileId ${profileFromLogin} != STAFF_PROFILE_ID ${STAFF_PROFILE_ID}`);
    }
    ok('Staff logged in (EMPLOYEE_APP)');
  } else {
    info('No STAFF_LOGIN/STAFF_PASSWORD — registration will use owner token');
  }
  const staffAuth = staffToken || ownerToken;

  // 1. Create work-shift
  step(1, 'Owner creates a work-shift template');
  const shiftName = `E2E Ca ${Date.now()}`;
  const workShift = await api('POST', `/stores/${STORE_ID}/work-shifts`, {
    token: ownerToken,
    json: {
      shiftName,
      startTime: '08:00:00',
      endTime: '12:00:00',
      defaultMaxStaff: 3,
    },
  });
  ok(`work-shift created: ${workShift.id} (${shiftName})`);
  record('create work-shift', 'PASS', workShift.id);

  // 2. Create active work-cycle with a slot for WORK_DATE
  step(2, 'Owner creates an ACTIVE work-cycle with one slot');
  const cycle = await api('POST', `/stores/${STORE_ID}/work-cycles`, {
    token: ownerToken,
    json: {
      name: `E2E Cycle ${Date.now()}`,
      cycleType: 'WEEKLY',
      startDate: WORK_DATE,
      slots: [{ workShiftId: workShift.id, workDate: WORK_DATE, maxStaff: 3 }],
    },
  });
  createdCycleId = cycle.id;
  const slot = cycle.slots?.[0];
  if (!slot) throw new Error('Cycle created but no slot returned');
  ok(`cycle ${cycle.id} active=${cycle.status}, slot ${slot.id} @ ${slot.workDate}`);
  record('create cycle+slot', 'PASS', `${cycle.id} / ${slot.id}`);

  // 3. Staff self-registers -> PENDING
  step(3, 'Staff self-registers to the slot (expect PENDING)');
  const assignment = await api('POST', `/stores/shift-slots/${slot.id}/register`, {
    token: staffAuth,
    json: { employeeId: STAFF_PROFILE_ID, note: 'E2E test', isOwnerAssign: false },
  });
  if (assignment.status !== 'PENDING') {
    bad(`expected PENDING, got ${assignment.status}`);
    record('register', 'WARN', `status=${assignment.status}`);
  } else {
    ok(`assignment ${assignment.id} status=PENDING`);
    record('register', 'PASS', assignment.id);
  }

  // 4. Owner approves -> APPROVED
  step(4, 'Owner approves the registration (expect APPROVED)');
  const approved = await api(
    'PUT',
    `/stores/shift-assignments/${assignment.id}/status`,
    { token: ownerToken, json: { status: 'APPROVED' } },
  );
  if (approved.status !== 'APPROVED') {
    bad(`expected APPROVED, got ${approved.status}`);
    record('approve', 'FAIL', `status=${approved.status}`);
  } else {
    ok(`assignment status=APPROVED (ready for check-in)`);
    record('approve', 'PASS', 'APPROVED');
  }

  // Cross-check via the staff-facing list
  const list = await api(
    'GET',
    `/stores/${STORE_ID}/shift-assignments?cycleId=${cycle.id}`,
    { token: ownerToken },
  );
  const found = (Array.isArray(list) ? list : list?.data || []).find(
    (a) => a.id === assignment.id,
  );
  if (found) ok(`assignment visible in store list with status=${found.status}`);
  else info('assignment not found in store list response (check shape)');

  // 5 & 6. Check-in / check-out
  step(5, 'Check-in / check-out');
  if (!WITH_ATTENDANCE) {
    info('SKIPPED — pass --with-attendance to attempt. These need a registered');
    info('face + a real photo; they are normally done on-device by the staff.');
    record('check-in', 'SKIP', 'needs face+photo (on-device)');
    record('check-out', 'SKIP', 'needs face+photo (on-device)');
  } else {
    try {
      if (env.FACE_PHOTOS) {
        const paths = env.FACE_PHOTOS.split(',').map((s) => s.trim()).filter(Boolean);
        const fd = new FormData();
        fd.append('storeId', STORE_ID);
        for (const p of paths) {
          const { blob, name } = fileToBlob(p);
          fd.append('photos', blob, name);
        }
        await api('POST', `/stores/employees/${STAFF_PROFILE_ID}/face-registration`, {
          token: staffAuth,
          form: fd,
        });
        ok(`face registered from ${paths.length} photo(s)`);
      }
      if (!env.CHECKIN_PHOTO) throw new Error('CHECKIN_PHOTO not set');

      const ci = new FormData();
      const ciPhoto = fileToBlob(env.CHECKIN_PHOTO);
      ci.append('photo', ciPhoto.blob, ciPhoto.name);
      ci.append('qrStoreId', STORE_ID);
      const ciRes = await api(
        'POST',
        `/stores/shift-assignments/${assignment.id}/check-in`,
        { token: staffAuth, form: ci },
      );
      if (ciRes?.matched === false) {
        bad(`check-in face not matched: ${ciRes.message}`);
        record('check-in', 'FAIL', ciRes.message);
      } else {
        ok('checked in');
        record('check-in', 'PASS', 'CONFIRMED');

        const co = new FormData();
        const coPhoto = fileToBlob(env.CHECKIN_PHOTO);
        co.append('photo', coPhoto.blob, coPhoto.name);
        co.append('qrStoreId', STORE_ID);
        const coRes = await api(
          'POST',
          `/stores/shift-assignments/${assignment.id}/check-out`,
          { token: staffAuth, form: co },
        );
        ok(`checked out — workedMinutes=${coRes.workedMinutes}, shiftEarnings=${coRes.shiftEarnings}`);
        record('check-out', 'PASS', `earnings=${coRes.shiftEarnings}`);
      }
    } catch (e) {
      bad(`attendance failed: ${e.message}`);
      record('check-in/out', 'FAIL', e.message);
    }
  }

  // 7. Payroll
  step(7, 'Owner generates payroll and reads it back');
  try {
    const gen = await api('POST', `/stores/${STORE_ID}/payrolls/generate`, {
      token: ownerToken,
      json: { date: WORK_DATE },
    });
    ok(`payroll generated (estimatedPayment=${gen?.estimatedPayment ?? '?'})`);
    record('payroll generate', 'PASS', `est=${gen?.estimatedPayment ?? '?'}`);

    const byMonth = await api(
      'GET',
      `/stores/${STORE_ID}/payrolls/by-month?date=${WORK_DATE}`,
      { token: ownerToken },
    ).catch(() => null);
    if (byMonth) ok('payroll readable via /payrolls/by-month');
  } catch (e) {
    bad(`payroll failed: ${e.message}`);
    record('payroll', 'FAIL', e.message);
  }
}

async function cleanup() {
  if (!CLEANUP || !createdCycleId || !ownerToken) return;
  step('cleanup', 'Best-effort: stop the cycle we created');
  try {
    await api('PUT', `/stores/work-cycles/${createdCycleId}/stop`, {
      token: ownerToken,
      json: { stopImmediately: true },
    });
    ok(`cycle ${createdCycleId} stopped`);
  } catch (e) {
    info(`cleanup skipped: ${e.message}`);
  }
}

function summary() {
  log('\n\x1b[1m──────── SUMMARY ────────\x1b[0m');
  for (const r of results) {
    const tag =
      r.status === 'PASS' ? '\x1b[32mPASS\x1b[0m'
      : r.status === 'SKIP' ? '\x1b[33mSKIP\x1b[0m'
      : r.status === 'WARN' ? '\x1b[33mWARN\x1b[0m'
      : '\x1b[31mFAIL\x1b[0m';
    log(`  ${tag}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
  }
  const failed = results.filter((r) => r.status === 'FAIL').length;
  log('');
  return failed;
}

main()
  .catch((e) => {
    bad(`FLOW ABORTED: ${e.message}`);
    if (e.data) info(`detail: ${JSON.stringify(e.data)}`);
    record('flow', 'FAIL', e.message);
  })
  .finally(async () => {
    await cleanup();
    const failed = summary();
    process.exit(failed > 0 ? 1 : 0);
  });
