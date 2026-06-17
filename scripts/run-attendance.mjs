#!/usr/bin/env node
/**
 * run-attendance.mjs — honest check-in/out using a real face photo.
 * Registers the staff face from REAL_PHOTO (x3), then check-in + check-out with
 * the same photo so the face engine genuinely matches. Then regenerates payroll.
 */
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:3000/api';
const STORE_ID = process.env.STORE_ID;
const STAFF_PROFILE_ID = process.env.STAFF_PROFILE_ID;
const PHOTO = process.env.REAL_PHOTO;

const log = (...a) => console.log(...a);
const ok = (m) => log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => log(`  \x1b[31m✗\x1b[0m ${m}`);
const inf = (m) => log(`  \x1b[36mi\x1b[0m ${m}`);
const step = (n, m) => log(`\n\x1b[1m[${n}] ${m}\x1b[0m`);

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
async function login(e, p, a) {
  const d = await api('POST', '/auth/login', { json: { emailOrPhone: e, password: p, appType: a } });
  return d?.access_token || d?.accessToken || d?.token;
}
function blob() { return new Blob([readFileSync(PHOTO)], { type: 'image/jpeg' }); }
const today = new Date().toISOString().slice(0, 10);

async function main() {
  if (!PHOTO) throw new Error('REAL_PHOTO env not set');
  log(`BASE=${BASE}\nPHOTO=${PHOTO}\ntoday=${today}`);
  const owner = await login('test_owner@timeso.com', 'Test123456', 'OWNER_APP');
  const staff = await login('test_staff@timeso.com', 'Test123456', 'EMPLOYEE_APP');
  ok('owner + staff logged in');

  // Find an APPROVED assignment for the staff today
  step(1, 'Locate an APPROVED assignment for staff');
  const list = await api('GET', `/stores/${STORE_ID}/shift-assignments`, { token: owner.token || owner });
  const arr = Array.isArray(list) ? list : list?.data || [];
  let a = arr.find((x) => x.employee?.id === STAFF_PROFILE_ID && x.status === 'APPROVED'
    && x.shiftSlot?.workDate?.slice(0, 10) === today);
  if (!a) a = arr.find((x) => x.employee?.id === STAFF_PROFILE_ID && x.status === 'APPROVED');
  if (!a) throw new Error('no APPROVED assignment found for staff');
  ok(`assignment ${a.id} (slot ${a.shiftSlot?.id}, ${a.shiftSlot?.workDate})`);

  // Register a REAL face (overwrites the seed mock descriptor)
  step(2, 'Register staff face from real photo (x3)');
  try {
    const fd = new FormData();
    fd.append('storeId', STORE_ID);
    fd.append('photos', blob(), 'f1.jpg');
    fd.append('photos', blob(), 'f2.jpg');
    fd.append('photos', blob(), 'f3.jpg');
    const reg = await api('POST', `/stores/employees/${STAFF_PROFILE_ID}/face-registration`, { token: staff, form: fd });
    ok(`face registered: ${JSON.stringify(reg).slice(0, 120)}`);
  } catch (e) {
    bad(`face registration failed: ${e.message}`);
    if (/No face detected|face/i.test(e.message)) inf('the photo likely has no detectable face — need a real face image');
    throw e;
  }

  // Check-in
  step(3, 'Check-in with the same photo (expect match)');
  const ci = new FormData();
  ci.append('photo', blob(), 'checkin.jpg');
  ci.append('qrStoreId', STORE_ID);
  ci.append('latitude', '10.8231');
  ci.append('longitude', '106.6297');
  const ciRes = await api('POST', `/stores/shift-assignments/${a.id}/check-in`, { token: staff, form: ci });
  if (ciRes?.matched === false) { bad(`check-in not matched: ${ciRes.message}`); throw new Error('check-in failed'); }
  ok(`checked in: ${JSON.stringify(ciRes).slice(0, 160)}`);

  // Check-out
  step(4, 'Check-out with the same photo');
  const co = new FormData();
  co.append('photo', blob(), 'checkout.jpg');
  co.append('qrStoreId', STORE_ID);
  co.append('latitude', '10.8231');
  co.append('longitude', '106.6297');
  const coRes = await api('POST', `/stores/shift-assignments/${a.id}/check-out`, { token: staff, form: co });
  ok(`checked out: workedMinutes=${coRes.workedMinutes}, shiftEarnings=${coRes.shiftEarnings}, status=${coRes.status || coRes.assignment?.status}`);

  // Payroll
  step(5, 'Generate payroll — should now include real shift earnings');
  const gen = await api('POST', `/stores/${STORE_ID}/payrolls/generate`, { token: owner, json: { date: today } });
  ok(`payroll estimatedPayment=${gen?.estimatedPayment}`);
  const byMonth = await api('GET', `/stores/${STORE_ID}/payrolls/by-month?date=${today}`, { token: owner }).catch(() => null);
  if (byMonth) {
    const mine = (byMonth.employeeSalaries || byMonth.salaries || []).find?.((s) => s.employeeProfileId === STAFF_PROFILE_ID);
    ok(`by-month payroll: ${JSON.stringify(byMonth).slice(0, 200)}`);
    if (mine) ok(`staff salary row: net=${mine.netSalary}, base=${mine.earnedBaseSalary ?? mine.baseSalary}`);
  }
}
main().then(() => log('\n\x1b[32mATTENDANCE FLOW OK\x1b[0m')).catch((e) => { bad(`ABORTED: ${e.message}`); if (e.data) inf(JSON.stringify(e.data)); process.exit(1); });
