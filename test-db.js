const { Client } = require('pg');
const client = new Client({
  host: process.env.DATABASE_HOST,
  port: 5432,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME
});
client.connect()
  .then(() => client.query("SELECT sa.id, sa.status, sa.employee_id, ws.\"shiftName\", slot.\"workDate\" FROM shift_assignments sa JOIN shift_slots slot ON sa.\"shiftSlotId\" = slot.id JOIN work_shifts ws ON slot.\"workShiftId\" = ws.id WHERE slot.\"workDate\" = '2026-06-10'"))
  .then(res => {
    console.table(res.rows);
    client.end();
  })
  .catch(err => {
    console.error(err);
    client.end();
  });
