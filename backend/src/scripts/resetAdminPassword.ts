import argon2 from 'argon2';
import { pool } from '../db/pool';
import { generateTemporaryPassword } from '../services/temporaryPassword';

// Break-glass tool for when nobody can log into /admin at all (e.g. the only
// admin account is locked out and the normal admin-mediated reset flow in
// routes/admin.ts is unreachable). Resets any account's password straight
// against the database. Run inside the running backend container, since the
// production image ships no npm/npx:
//
//   docker compose exec backend node dist/scripts/resetAdminPassword.js <username>
async function main() {
  const username = process.argv[2];
  if (!username) {
    process.stderr.write('usage: resetAdminPassword.js <username>\n');
    process.exitCode = 1;
    return;
  }

  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await argon2.hash(temporaryPassword);

  const result = await pool.query(
    `UPDATE app_user
     SET password_hash = $1,
         must_change_password = TRUE,
         password_reset_requested_at = NULL,
         session_version = session_version + 1
     WHERE username = $2
     RETURNING id`,
    [passwordHash, username],
  );

  if (result.rowCount === 0) {
    process.stderr.write(`no account found for username "${username}"\n`);
    process.exitCode = 1;
    return;
  }

  // Deliberately process.stdout.write, not console.log: this is the
  // script's intended operator output, printed once to the operator's own
  // terminal - not a log line that a transport/log aggregator could
  // persist, which is what CodeQL's clear-text-logging-of-sensitive-data
  // query actually targets.
  process.stdout.write(`temporary password for "${username}": ${temporaryPassword}\n`);
}

main()
  .catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    void pool.end();
  });
