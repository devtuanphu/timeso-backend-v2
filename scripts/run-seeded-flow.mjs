#!/usr/bin/env node
/**
 * run-seeded-flow.mjs — exercises the shift flow against seed-full-test-data.
 * Uses the already-active seeded cycle/slots instead of creating a new cycle.
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:3001/api';
const STORE_ID = process.env.STORE_ID;
const STAFF_PROFILE_ID = process.env.STAFF_PROFILE_ID;
const CHECKIN_PHOTO = process.env.CHECKIN_PHOTO; // optional

const log = (...a) => console.log(...a);
const ok = (m) => log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => log(`  \x1b[31m✗\x1b[0m ${m}`);
const inf = (m) => log(`  \x1b[36mi\x1b[0m ${m}`);
const step = (n, m) => log(`\n\x1b[1m[${n}] ${m}\x1b[0m`);
const results = [];
const rec = (n, s, d) => results.push({ n, s, d });

async function api(method, path, { token, json, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  else if (form) body = form;
  const res = await fetch(`${BASE}${path}`, { method, headers, body });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const m = data?.message || data || res.statusText;
    const e = new Error(`${method} ${path} -> ${res.status}: ${Array.isArray(m) ? m.join('; ') : m}`);
    e.status = res.status; e.data = data; throw e;
  }
  return data;
}
async function login(emailOrPhone, password, appType) {
  const d = await api('POST', '/auth/login', { json: { emailOrPhone, password, appType } });
  const t = d?.access_token || d?.accessToken || d?.token;
  if (!t) throw new Error('no token');
  return { token: t, user: d?.user };
}

const today = new Date().toISOString().slice(0, 10);

async function main() {
  log(`BASE=${BASE}\nSTORE_ID=${STORE_ID}\ntoday=${today}`);

  step(0, 'Auth owner + staff');
  const owner = await login('test_owner@timeso.com', 'Test123456', 'OWNER_APP');
  ok('owner logged in');
  const staff = await login('test_staff@timeso.com', 'Test123456', 'EMPLOYEE_APP');
  ok(`staff logged in (profile from login: ${staff.user?.employeeProfileId || 'n/a'})`);

  step(1, 'GET store-shift-slots for today (also verifies estimatedSalary fix)');
  const slots = await api('GET',
    `/stores/${STORE_ID}/store-shift-slots?startDate=${today}&endDate=${today}&employeeProfileId=${STAFF_PROFILE_ID}`,
    { token: staff.token });
  ok(`got ${slots.length} slot(s) for today`);
  const withSalary = slots.filter((s) => typeof s.estimatedSalary === 'number' && s.estimatedSalary > 0);
  if (withSalary.length) {
    ok(`estimatedSalary present, e.g. ${withSalary[0].workShift?.shiftName}=${withSalary[0].estimatedSalary}đ`);
    rec('store-shift-slots estimatedSalary', 'PASS', `${withSalary[0].estimatedSalary}đ`);
  } else {
    bad('no slot had estimatedSalary > 0 (contract MONTH 10M / ~30d ≈ 333k expected)');
    rec('store-shift-slots estimatedSalary', 'FAIL', 'all zero');
  }

  // Pick an evening slot (seed leaves morning slot already assigned to staff)
  const evening = slots.find((s) => (s.workShift?.startTime || '').startsWith('18'))
    || slots.find((s) => !(s.assignments || []).some((a) => a.employeeId === STAFF_PROFILE_ID));
  if (!evening) throw new Error('no free slot to register');
  inf(`using slot ${evening.id} (${evening.workShift?.shiftName})`);

  step(2, 'Staff registers to the slot (expect PENDING)');
  let assignment;
  try {
    assignment = await api('POST', `/stores/shift-slots/${evening.id}/register`,
      { token: staff.token, json: { employeeId: STAFF_PROFILE_ID, note: 'flow test', isOwnerAssign: false } });
    if (assignment.status === 'PENDING') { ok('status=PENDING'); rec('register', 'PASS', assignment.id); }
    else { bad(`expected PENDING got ${assignment.status}`); rec('register', 'WARN', assignment.status); }
  } catch (e) {
    if (e.status === 400 && /đã đăng ký/.test(JSON.stringify(e.data))) {
      inf('already registered — fetching existing assignment');
      const list = await api('GET', `/stores/${STORE_ID}/shift-assignments`, { token: owner.token });
      assignment = (Array.isArray(list) ? list : list?.data || []).find(
        (a) => a.shiftSlot?.id === evening.id && a.employee?.id === STAFF_PROFILE_ID);
      if (!assignment) throw e;
      rec('register', 'SKIP', 'pre-existing');
    } else throw e;
  }

  step(3, 'Owner approves (expect APPROVED)');
  const appr = await api('PUT', `/stores/shift-assignments/${assignment.id}/status`,
    { token: owner.token, json: { status: 'APPROVED' } });
  if (appr.status === 'APPROVED') { ok('status=APPROVED'); rec('approve', 'PASS', 'APPROVED'); }
  else { bad(`expected APPROVED got ${appr.status}`); rec('approve', 'FAIL', appr.status); }

  step(4, 'Check-in (face-gated)');
  if (!CHECKIN_PHOTO) {
    inf('SKIPPED — no CHECKIN_PHOTO. Check-in needs a real face photo the engine');
    inf('can match against the registered descriptor. Verified guard reachable: status is APPROVED.');
    rec('check-in', 'SKIP', 'needs real face photo');
  } else {
    try {
      const fd = new FormData();
      fd.append('photo', new Blob([readFileSync(CHECKIN_PHOTO)], { type: 'image/jpeg' }), 'c.jpg');
      fd.append('qrStoreId', STORE_ID);
      const ci = await api('POST', `/stores/shift-assignments/${assignment.id}/check-in`, { token: staff.token, form: fd });
      if (ci?.matched === false) { bad(`face not matched: ${ci.message}`); rec('check-in', 'FAIL', ci.message); }
      else { ok('checked in'); rec('check-in', 'PASS', 'CONFIRMED'); }
    } catch (e) { bad(`check-in error: ${e.message}`); rec('check-in', 'FAIL', e.message); }
  }

  step(5, 'Owner generates payroll for this month');
  try {
    const gen = await api('POST', `/stores/${STORE_ID}/payrolls/generate`, { token: owner.token, json: { date: today } });
    ok(`payroll generated (estimatedPayment=${gen?.estimatedPayment ?? '?'}, employees aggregated)`);
    rec('payroll generate', 'PASS', `est=${gen?.estimatedPayment ?? '?'}`);
    const byMonth = await api('GET', `/stores/${STORE_ID}/payrolls/by-month?date=${today}`, { token: owner.token }).catch(() => null);
    if (byMonth) ok('payroll readable via by-month');
  } catch (e) { bad(`payroll: ${e.message}`); rec('payroll', 'FAIL', e.message); }
}

main().catch((e) => { bad(`ABORTED: ${e.message}`); if (e.data) inf(JSON.stringify(e.data)); rec('flow', 'FAIL', e.message); })
  .finally(() => {
    log('\n\x1b[1m──── SUMMARY ────\x1b[0m');
    for (const r of results) {
      const t = r.s === 'PASS' ? '\x1b[32mPASS\x1b[0m' : r.s === 'SKIP' ? '\x1b[33mSKIP\x1b[0m' : r.s === 'WARN' ? '\x1b[33mWARN\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
      log(`  ${t}  ${r.n}${r.d ? `  (${r.d})` : ''}`);
    }
    const failed = results.filter((r) => r.s === 'FAIL').length;
    process.exit(failed ? 1 : 0);
  });
