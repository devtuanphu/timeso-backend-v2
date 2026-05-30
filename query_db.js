const { Client } = require('pg');

const client = new Client({
  host: '150.95.113.77',
  port: 5432,
  user: 'timeso_db_v2',
  password: 'fsceIyc0LVf7PFHT',
  database: 'timeso_db_v2',
});

async function run() {
  await client.connect();
  const res = await client.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'bonus_work_requests'");
  console.log(res.rows.map(r => r.column_name));
  await client.end();
}

run().catch(console.error);
