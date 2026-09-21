/**
 * Moves CCCD / identity scans that older builds wrote into the public
 * `./uploads` directory into `./uploads-private/identity`, and rewrites
 * `account_identity_documents.front_image_url` / `back_image_url` to the
 * authenticated route `/api/accounts/identity/image/<file>`.
 *
 * Run on the API host, from the repository root, with the same DATABASE_*
 * environment as the server:
 *
 *   node scripts/migrate_identity_images_private.js           # dry run
 *   node scripts/migrate_identity_images_private.js --apply   # move + update
 *
 * Idempotent: rows already pointing at the private route are not rewritten,
 * and a file that was already moved is not moved again. When a private copy
 * already exists, the public copy is deleted (apply mode only) so it is no
 * longer served from /uploads — including leftovers from rows an earlier
 * version of this script migrated while leaving the public file behind. A
 * public copy whose bytes differ from the private one is kept and reported.
 */
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const PUBLIC_DIR = path.resolve('uploads');
const PRIVATE_DIR = path.resolve('uploads-private/identity');
const PRIVATE_PREFIX = '/api/accounts/identity/image/';
const PUBLIC_PREFIX = '/uploads/';

/**
 * Moves one identity file from the public to the private directory.
 * Returns what happened: 'missing' (neither exists), 'moved' / 'would-move',
 * 'removed-public' / 'would-remove-public' (both existed and matched),
 * 'conflict' (both existed with different bytes; nothing touched) or
 * 'already-private'.
 */
function reconcileIdentityFile(from, to, apply, fsImpl = fs) {
  const hasPublic = fsImpl.existsSync(from);
  const hasPrivate = fsImpl.existsSync(to);
  if (!hasPublic && !hasPrivate) return 'missing';
  if (!hasPublic) return 'already-private';
  if (!hasPrivate) {
    if (apply) fsImpl.renameSync(from, to);
    return apply ? 'moved' : 'would-move';
  }
  if (!fsImpl.readFileSync(from).equals(fsImpl.readFileSync(to))) {
    return 'conflict';
  }
  if (apply) fsImpl.unlinkSync(from);
  return apply ? 'removed-public' : 'would-remove-public';
}

function toPrivate(url) {
  if (typeof url !== 'string' || !url.startsWith(PUBLIC_PREFIX)) return null;
  const filename = url.slice(PUBLIC_PREFIX.length);
  if (!/^[A-Za-z0-9._-]+$/.test(filename)) return null;
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
  try {
    const { rows } = await client.query(
      `SELECT id, front_image_url, back_image_url
         FROM account_identity_documents
        WHERE front_image_url LIKE '/uploads/%' OR back_image_url LIKE '/uploads/%'`,
    );
    console.log(`${rows.length} identity document(s) still point at /uploads`);
    if (APPLY) fs.mkdirSync(PRIVATE_DIR, { recursive: true });

    let moved = 0;
    let missing = 0;
    let removedPublic = 0;
    let conflicts = 0;
    for (const row of rows) {
      const updates = {};
      for (const column of ['front_image_url', 'back_image_url']) {
        const filename = toPrivate(row[column]);
        if (!filename) continue;
        const from = path.join(PUBLIC_DIR, filename);
        const to = path.join(PRIVATE_DIR, filename);
        const outcome = reconcileIdentityFile(from, to, APPLY);
        if (outcome === 'missing') {
          missing += 1;
          continue;
        }
        if (outcome === 'conflict') {
          conflicts += 1;
          console.warn(`Public and private copies differ, left as is: ${filename}`);
          continue;
        }
        if (outcome.endsWith('remove-public')) removedPublic += 1;
        updates[column] = `${PRIVATE_PREFIX}${filename}`;
        moved += 1;
      }
      const columns = Object.keys(updates);
      if (APPLY && columns.length) {
        const set = columns.map((c, i) => `${c} = $${i + 2}`).join(', ');
        await client.query(
          `UPDATE account_identity_documents SET ${set} WHERE id = $1`,
          [row.id, ...columns.map((c) => updates[c])],
        );
      }
    }
    // Rows already on the private route can still have a public copy left by
    // an earlier run of this script, which only moved a file when no private
    // copy existed yet.
    const migrated = await client.query(
      `SELECT front_image_url, back_image_url
         FROM account_identity_documents
        WHERE front_image_url LIKE $1 OR back_image_url LIKE $1`,
      [`${PRIVATE_PREFIX}%`],
    );
    for (const row of migrated.rows) {
      for (const column of ['front_image_url', 'back_image_url']) {
        const value = row[column];
        if (typeof value !== 'string' || !value.startsWith(PRIVATE_PREFIX)) continue;
        const filename = value.slice(PRIVATE_PREFIX.length);
        if (!/^[A-Za-z0-9._-]+$/.test(filename)) continue;
        const outcome = reconcileIdentityFile(
          path.join(PUBLIC_DIR, filename),
          path.join(PRIVATE_DIR, filename),
          APPLY,
        );
        if (outcome.endsWith('remove-public')) removedPublic += 1;
        if (outcome === 'conflict') {
          conflicts += 1;
          console.warn(`Public and private copies differ, left as is: ${filename}`);
        }
      }
    }

    console.log(
      `${APPLY ? 'Moved' : 'Would move'} ${moved} file(s); ${missing} referenced file(s) not found on disk`,
    );
    console.log(
      `${APPLY ? 'Deleted' : 'Would delete'} ${removedPublic} leftover public copy(ies); ${conflicts} conflict(s) left for review`,
    );
    if (!APPLY) console.log('Dry run only. Re-run with --apply to make changes.');
  } finally {
    await client.end();
  }
}

module.exports = { reconcileIdentityFile, toPrivate };

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
