// config.js — where the live database lives
// Owner: Member 4. The publishable key is safe to put in a website: it can only do
// what the database's row-level security and booking functions allow.
const SUPABASE_URL = 'https://ndvnvalwbtqgutpfsqfa.supabase.co';
const SUPABASE_KEY = 'sb_publishable_CjZAc_97ahGBCbWN7CT_Og_tjBXpbZ3';

// Sign in with a mobile number (OTP by SMS) needs a paid SMS sender (Twilio/MSG91 + DLT in India).
// Until one is set up in Supabase, the number box stays hidden; turn this on once SMS works.
const SMS_SIGN_IN = false;

// Job alerts on a closed app (Web Push, supabase/034 and supabase/functions/job-alert).
// The public half of the VAPID key pair; the private half is a secret of the job-alert function.
const PUSH_PUBLIC_KEY = 'BNAzkP5EyJa8IkK9v8RiZzhliDCjglkHwS_ed8yrs9QgaZ9jgiz4lxi76oCvjAyG-HijluxUzBndNEpMfKIHHqU';

// Bot check before a new sign-in (Cloudflare Turnstile). Paste the widget's site key here, deploy,
// then switch CAPTCHA on in Supabase (Authentication → Attack Protection) with the secret key.
// Empty = no check (Supabase must have CAPTCHA off then, or nobody can sign in).
const TURNSTILE_SITE_KEY = '';
