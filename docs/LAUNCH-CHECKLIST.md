# Launch checklist: steps outside the code

The code for the four launch blockers is in this repository. These steps are done by hand in the Supabase, GitHub and Vercel dashboards, in this order.

## 1. Run the new database changes

Supabase → **SQL Editor** → paste and run, one at a time:

1. `supabase/018_trust_and_safety.sql`
2. `supabase/019_privacy.sql`

The new app files expect these, so run them **before** the new version goes live on Vercel.

## 2. Make yourself an admin

Sign in on the worker or employer app with your own Google account or mobile number. Then in the SQL editor:

```sql
insert into public.admins (auth_id, note)
select id, 'Founder' from auth.users where phone = '91XXXXXXXXXX';   -- or: where email = 'you@example.com'
```

Open `/admin/` on the live site to see reports.

## 3. Turn on real sign-in and stop fake accounts

1. Supabase → **Authentication → Sign In / Providers**:
   - **Phone**: turn on and connect an SMS provider (MSG91, Twilio or Vonage). Indian numbers need a DLT-registered SMS template.
   - **Google**: turn on with a Google Cloud OAuth client.
   - **Anonymous sign-ins**: keep on (the app starts every phone with one).
2. Supabase → **Authentication → Attack Protection**: turn on **CAPTCHA** (Cloudflare Turnstile) and keep the default rate limits. *The app does not send a CAPTCHA token yet; turning this on will block new anonymous sign-ins until it does. Leave it off until that change is made.*
3. Once you can sign in with a mobile number yourself, require a real account for posting and taking jobs:
   ```sql
   update public.app_settings set value = 'true' where key = 'require_verified';
   ```
   People already using the app are asked to sign in the next time they post or accept a job.

## 4. Privacy notice

Replace `GRIEVANCE_EMAIL` in `privacy/index.html` with the email address of the person who answers privacy complaints, before the page goes live.

## 5. Backups

Follow `docs/BACKUP-AND-RESTORE.md`: upgrade to Pro with point-in-time recovery, add the two backup secrets, and do the restore drill once.

## 6. Tests

Every pull request now runs `.github/workflows/checks.yml`. It builds the database from all the migrations on a clean Postgres and checks the safety rules. To run it on your own computer (Postgres 15 or newer):

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres supabase/tests/run.sh
```

A new migration that adds a function acting for a worker or employer must call `public.assert_mine(...)` (or `assert_party` / `assert_admin`) in its own source; the tests fail otherwise.
