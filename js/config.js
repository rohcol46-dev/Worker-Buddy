// config.js — where the live database lives
// Owner: Member 4. The publishable key is safe to put in a website: it can only do
// what the database's row-level security and booking functions allow.
const SUPABASE_URL = 'https://ndvnvalwbtqgutpfsqfa.supabase.co';
const SUPABASE_KEY = 'sb_publishable_CjZAc_97ahGBCbWN7CT_Og_tjBXpbZ3';

// Sign in with a mobile number (OTP by SMS) needs a paid SMS sender (Twilio/MSG91 + DLT in India).
// Until one is set up in Supabase, the number box stays hidden; turn this on once SMS works.
const SMS_SIGN_IN = false;
