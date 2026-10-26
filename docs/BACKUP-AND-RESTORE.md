# Backups and restore

Workers are told to show their Worker Buddy wage record for loans and welfare schemes, so losing the database would break the app's main promise. There are two layers of protection.

## 1. Supabase Pro with point-in-time recovery (main protection)

The free plan pauses after a week without use and keeps no backups you can restore. Before real users arrive:

1. Supabase dashboard → **Organization → Billing** → upgrade the organization to **Pro**.
2. Project → **Database → Backups** → turn on **Point in Time Recovery** (an add-on). With it you can roll the database back to any second in the last 7 days.
3. Pro also keeps daily backups for 7 days, restorable from the same page.

## 2. Nightly encrypted copy outside Supabase (in case the Supabase project itself is lost)

`.github/workflows/backup.yml` runs every night at 2 AM (India time). It dumps the `public` schema (profiles, jobs, pay slips) and the `auth` schema (sign-ins), encrypts the file with a passphrase, and keeps it as a GitHub Actions artifact for 30 days.

**This repository is public.** Anyone signed in to GitHub can download its workflow artifacts, so the file is always encrypted before upload. Never remove the encryption step.

Set it up once:

1. Supabase → **Connect** → copy the **Session pooler** connection string (it works on GitHub's IPv4 network). Put the database password into it.
2. GitHub → this repository → **Settings → Secrets and variables → Actions → New repository secret**:
   - `SUPABASE_DB_URL`: the connection string from step 1
   - `BACKUP_PASSPHRASE`: a long random passphrase. **Save a copy in a password manager.** Without it the backups can't be opened.
3. **Actions → Nightly database backup → Run workflow** to test it now. The run should end with a `worker-buddy-YYYY-MM-DD.dump.gpg` artifact.

Until both secrets are set, the workflow skips itself with a warning instead of failing.

## Restore drill (do this once now, then every 3 months)

Practise on a **new, empty Supabase project**, never on the live one.

1. Download the newest `db-backup-…` artifact from **Actions → Nightly database backup** and unzip it.
2. Decrypt it:
   ```bash
   gpg --decrypt --output db.dump worker-buddy-YYYY-MM-DD.dump.gpg
   ```
3. Restore the app data into the scratch project (its Session pooler connection string):
   ```bash
   pg_restore --no-owner --no-privileges --clean --if-exists --schema=public -d "$SCRATCH_DB_URL" db.dump
   ```
4. Restore the sign-ins so people keep their accounts:
   ```bash
   pg_restore --no-owner --no-privileges --data-only --schema=auth --table=users --table=identities -d "$SCRATCH_DB_URL" db.dump
   ```
5. Check it worked: in the scratch project's SQL editor, `select count(*) from public.bookings;` should match the live number from the night of the backup.
6. Point a local copy of the app at the scratch project (`js/config.js`) and open a pay slip.

Write down the date and how long it took. If the live project is ever lost, the same steps restore it into a new project; then update `js/config.js` with the new project's address and key.
