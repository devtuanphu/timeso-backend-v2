#!/usr/bin/env node
/**
 * Moves identity documents (CCCD/ID scans) out of the publicly served
 * `uploads/` directory into `uploads-private/identity/`, and rewrites the
 * matching rows to the authenticated route.
 *
 * Background: `ServeStaticModule` publishes `uploads/` at `/uploads` with no
 * authentication, so any identity scan stored there is readable by anyone
 * holding the URL. New uploads already go to the private directory; this script
 * relocates the ones written by earlier builds.
 *
 * SAFETY
 *   - Defaults to a dry run. Pass --apply to make changes.
 *   - Copies first, updates the row, and only then removes the public file, so
 *     an interrupted run never leaves a row pointing at a missing file.
 *   - Re-runnable: rows already on the private route are skipped.
 *
 * USAGE
 *   node scripts/migrate_identity_documents_to_private.js           # dry run
 *   node scripts/migrate_identity_documents_to_private.js --apply
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

require('dotenv').config();

const APPLY = process.argv.includes('--apply');
const PUBLIC_DIR = path.resolve('./uploads');
const PRIVATE_DIR = path.resolve('./uploads-private/identity');
const PUBLIC_PREFIX = '/uploads/';
const PRIVATE_PREFIX = '/api/accounts/identity/image/';

function privateUrlFor(filename) {
  return `${PRIVATE_PREFIX}${filename}`;
}

/** Rejects anything that is not a bare filename. */
function safeFilename(url) {
  if (typeof url !== 'string' || !url.startsWith(PUBLIC_PREFIX)) return null;
  const filename = url.slice(PUBLIC_PREFIX.length);
  if (!/^[A-Za-z0-9._-]+$/.test(filename) || filename.includes('..')) return null;
  return filename;
}

async function main() {
  const client = new Client({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT || 5432),
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
  });
  await client.connect();

  const { rows } = await client.query(
    `SELECT id, front_image_url, back_image_url
       FROM account_identity_documents
      WHERE front_image_url LIKE $1 OR back_image_url LIKE $1`,
    [`${PUBLIC_PREFIX}%`],
  );

  console.log(
    `${APPLY ? 'APPLY' : 'DRY RUN'}: ${rows.length} identity row(s) still on the public path.`,
  );
  if (APPLY) fs.mkdirSync(PRIVATE_DIR, { recursive: true });

  let moved = 0;
  let missing = 0;

  for (const row of rows) {
    const updates = {};

    for (const column of ['front_image_url', 'back_image_url']) {
      const filename = safeFilename(row[column]);
      if (!filename) continue;

      const from = path.join(PUBLIC_DIR, filename);
      const to = path.join(PRIVATE_DIR, filename);

      if (!fs.existsSync(from)) {
        // The row references a file that is already gone; still repoint it so
        // the record stops advertising a public URL.
        console.warn(`  missing file for ${row.id}.${column}: ${filename}`);
        missing += 1;
        updates[column] = privateUrlFor(filename);
        continue;
      }

      if (APPLY) fs.copyFileSync(from, to);
      updates[column] = privateUrlFor(filename);
      moved += 1;
      console.log(`  ${row.id}.${column}: ${filename} -> private`);
    }

    if (!Object.keys(updates).length || !APPLY) continue;

    const sets = Object.keys(updates).map((c, i) => `${c} = $${i + 2}`);
    await client.query(
      `UPDATE account_identity_documents SET ${sets.join(', ')} WHERE id = $1`,
      [row.id, ...Object.values(updates)],
    );

    // Only now is the public copy safe to remove.
    for (const column of Object.keys(updates)) {
      const filename = safeFilename(row[column]);
      if (!filename) continue;
      const from = path.join(PUBLIC_DIR, filename);
      if (fs.existsSync(from) && fs.existsSync(path.join(PRIVATE_DIR, filename))) {
        fs.unlinkSync(from);
      }
    }
  }

  console.log(
    `Done. ${moved} file(s) ${APPLY ? 'moved' : 'would move'}, ${missing} row(s) referenced a missing file.`,
  );
  if (!APPLY) console.log('Re-run with --apply to make changes.');
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
