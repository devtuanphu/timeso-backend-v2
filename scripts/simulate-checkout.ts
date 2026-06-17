import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
dotenv.config();

// Simulates a check-out (what the face flow would produce) on the seeded
// staff's APPROVED morning assignment, then we can verify payroll picks it up.
async function run() {
  const ds = new DataSource({
    type: 'postgres',
    host: process.env.DATABASE_HOST,
    port: parseInt(process.env.DATABASE_PORT || '5432'),
    username: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    entities: ['src/**/*.entity.{ts,js}'],
    synchronize: false,
  });
  await ds.initialize();
  const saRepo = ds.getRepository('ShiftAssignment');
  const STAFF = 'f7057fd2-af22-4d7c-8f5a-12f718fd701b';

  // Find an APPROVED/PENDING assignment for staff and mark it COMPLETED.
  const a: any = await saRepo
    .createQueryBuilder('sa')
    .leftJoinAndSelect('sa.shiftSlot', 'slot')
    .where('sa.employeeId = :STAFF', { STAFF })
    .orderBy('slot.workDate', 'DESC')
    .getOne();
  if (!a) { console.log('no assignment found'); await ds.destroy(); return; }

  const now = new Date();
  const checkIn = new Date(now.getTime() - 4 * 60 * 60 * 1000); // 4h shift
  a.status = 'COMPLETED';
  a.checkInTime = checkIn;
  a.checkOutTime = now;
  a.workedMinutes = 240;
  a.attendanceStatus = 'ON_TIME';
  // MONTH contract 10,000,000 / 30 days ≈ 333,333 per shift
  a.shiftEarnings = Math.round(10000000 / 30);
  await saRepo.save(a);
  console.log(`Marked assignment ${a.id} COMPLETED, workedMinutes=240, shiftEarnings=${a.shiftEarnings}`);
  await ds.destroy();
}
run().catch((e) => { console.error(e); process.exit(1); });
