const { Client } = require('pg');

const client = new Client({
  host: process.env.DATABASE_HOST,
  port: 5432,
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
});

async function run() {
  await client.connect();
  const res = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'bonus_work_requests'");
  console.log(res.rows.map(r => r.column_name));
  await client.end();
}

run().catch(console.error);
