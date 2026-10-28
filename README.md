# Worker Buddy

**Fair pay, safe work and the next job, one tap away.**

Two linked mobile web apps for India's offline daily-wage workers (coolies, helpers, plumbers, electricians, masons, painters) and the people who hire them.

Team **Tyrex** · Team ID **DEX26189** · Sathyabama Dexathon 2026

## The job flow (same as the pitch deck, slide 3)

| Step | In the app |
|---|---|
| **01 Post job** | Employer picks the work, place, hours, effort and how many workers, now or later, and taps **Post job** |
| **02 Fair rate calculated** | The fair-wage range and its breakdown show before anyone accepts. A **📋 Fair rate card** is in both apps |
| **03 Shared on WhatsApp** | Nearby online workers' phones ring, and **📲 Share job on WhatsApp** sends a link. Tapping the link opens the job in the worker app (and puts the worker online). A posted job stays open 10 minutes |
| **04 Worker accepts** | Tap Accept, say "accept" (English, Hindi or Tamil), or ask for a little more. The worker starts with the employer's 4-digit OTP, typed or spoken |
| **05 Work + heat alerts** | Live timer and overtime. On a hot day, both phones show a heat alert, the worker gets a water-break reminder every hour, and can tap **🤒 I feel unwell from the heat** for first aid, which is also saved as a heat report |
| **06 Pay slip + rating** | Employer pays, the worker confirms (tap or say "received"), the pay slip is created, and both rate each other. Workers' tags become the employer's **welfare rating** |

## Matches the deck

| Deck says | Where it is |
|---|---|
| Voice-first | 🎤 button on the worker app: "go online", "accept", "decline", the OTP digits, "done", "received", "read", in English, Hindi and Tamil. Plus 🔊 read-aloud everywhere |
| Fair-wage engine, minimum-wage rate cards | Wage breakdown on every job, **📋 Fair rate card** |
| Skill badges, ITI skill verification | Badges: ✔ Trusted, 🎓 ITI certified (to verify), 🏅 years of experience, 💼 jobs done. Workers add their ITI number when signing up |
| Welfare ratings | Workers tag employers (water, shade, respectful, safe site, paid on time); shown on job requests and on the employer's score card |
| Rest-point map | Real water, shade, toilets and tea shops (OpenStreetMap) plus 🤝 rest points hosted by shops |
| WhatsApp booking | 📲 Share job on WhatsApp with a link that opens the job |
| Zero commission | Shown on the worker home screen and every pay slip |
| OTP-verified ratings | Ratings only open after an OTP-started, completed job |
| Metrics: earnings, idle days, commission loss, heat incidents | Earnings screen: week / month / all time, days worked, days without work, deductions ₹0; heat reports saved in the `heat_reports` table |

> **Tech note for slide 3:** the app uses **Supabase** (live database + real-time) instead of Node.js + a JSON file, and is hosted on Vercel.

## 27 more features

| # | Feature | Where |
|---|---|---|
| 1 | **Show-up pay** ₹100 when the employer cancels after the worker set off; they can't post again until it is paid | Employer: Bookings · Worker: Earnings |
| 2 | **UPI pay QR**: the worker shows a standard UPI QR (their UPI ID and the job amount) that the employer scans with GPay, PhonePe, Paytm, FamPay or any UPI app; the worker then taps "I got it" to confirm | Completed job, both apps |
| 3 | **Rights helper**: ask by voice or text in Tamil, Hindi or English ("is ₹400 fair for a coolie?", "not paid", "hurt"), answers read aloud, helplines | Worker: Safety |
| 4 | **Contractor (mestri) crew book**: members, daily attendance, weekly pay, pay slip by SMS or WhatsApp | Worker: 👥 Crew tab |
| 5 | **Wage map**: what people were actually paid, by area and skill | `/wages/` (linked everywhere) |
| 6 | **Travel allowance**: over 5 km, ₹50 +₹10 per km (up to ₹150), worked out when the worker accepts | Request, pay slip |
| 7 | **Rain-off pay**: work stopped by rain is paid for time worked, at least half | Employer: started job |
| 8 | **Tools**: workers list their tools; employers can ask for own tools (+₹50) | Sign-up, post form |
| 9 | **Materials list**: the worker adds parts bought, the employer approves, repaid with the wage | Live job, both apps |
| 10 | **Meal / water / shade / toilet provided** tags | Post form, request, WhatsApp text |
| 11 | **18+ only**: birth year at sign-up, checked by the database too | Worker sign-up |
| 12 | **Night jobs** (8 PM–6 AM) only from GST-verified employers; workers are told to share with family | Employer: Bookings (GST) |
| 13 | **Site check-in**: work starts with the employer's OTP; there is no distance limit, so any worker can take a job anywhere. Where the worker started is saved for the evidence page | Start work |
| 14 | **Dispute room**: one page with every piece of evidence and server times, to print or share | `/dispute/?b=…`, ⚖️ buttons |
| 15 | **Migrant workers**: home state and city on the profile; ratings and records move with them | Sign-up / profile |
| 16–18 | **Ration shop, place to stay, crèche/school finders** (OpenStreetMap), plus One Nation One Ration Card info | Worker: Safety |
| 19 | **Lessons with badges**: heat, electrical, height, wage rights; read aloud, one quiz question; 2 lessons give 🎓 Safety trained | Worker: Schemes |
| 20 | **Availability calendar**: days I'm free; employers booking for later see how many are free that day | Worker home, employer "Later" |
| 21 | **Streaks**: jobs in a row rated 4★+; "Can't come" resets it; badge at 5, 10, 25 | Profile badges |
| 22 | **₹2/day accident cover** interest (pilot idea, not active) | Worker: Schemes |
| 23 | **Favourite workers first**: favourites see a new job for 1 minute before everyone | Worker profile ❤️, post form |
| 24 | **Monthly expense report** (printable) | Employer: Bookings |
| 25 | **Repeat jobs** every week, same day and time | Post form, "Later" |
| 26 | **Pay slip by SMS** for basic phones | Every pay slip |
| 27 | **Shared phone mode**: several workers on one family phone, each with a PIN | Worker sign-up screen |
| 28 | **Night pay**: +20% for work between 8 PM and 6 AM, shown in the fair-rate breakdown | Post form |
| 29 | **Work harder than described**: the worker says the work is heavier or risky; the extra comes from the wage rules (medium +₹50, heavy +₹100, risky +₹100). Payment waits until the employer accepts (added to the wage) or refuses (shown on their profile to every worker). Recorded on the evidence page | Live job, both apps (`supabase/008_harder_work.sql`) |
| 30 | **Cancel with a reason (like Rapido)**: one Cancel button for the worker and the employer at every stage, with a reason list or a typed reason; the other side sees who cancelled and why. Worker before starting: the job goes to other workers. Worker after starting: the job closes unpaid. Employer after the worker set off: ₹100 show-up pay. Employer after the work started: counts as unpaid on their Fair Pay Score | Live job, bookings, both apps |

### How the fair rate is worked out
Base rate for the kind of work (8 hours, never below the Tamil Nadu minimum wage of ₹610 a day) → each hour past 8 at twice the hourly rate (Code on Wages, 2019), or by the hour for short jobs (at least half a day) → effort (medium +₹50, heavy +₹100) → risky +₹100 → own tools +₹50 → night +20% → hot day +10% (daytime only). Travel (₹50–150 past 5 km), rain-off and show-up pay are added on the day. Gender, caste, age and home state are never inputs, so the same work gets the same rate.

## The problems we solve

| Problem | How Worker Buddy solves it |
|---|---|
| Unequal pay | Fair-wage estimate with a visible breakdown, agreed before work starts |
| Nature of work (how hard it is) | Pay goes up for heavy effort and risky work (height, electric, sewer) |
| Time | OTP records the real start; overtime past the agreed hours is paid double, automatically |
| Working conditions | Heat alert with heat pay, safety gear checklist, SOS with live location |
| Shade, shelter, resting areas | Map of real shelters, water points and toilets near the worker (OpenStreetMap) |
| Nearby shops for drinks | Real tea shops, eateries and small shops nearby on the same map |
| Worker–owner connection | Direct booking, call, WhatsApp, two-way ratings, Fair Pay Score |
| Remote hiring | Book from anywhere; online workers nearby get a ringing request (Rapido-style) |

## Novelty

| Feature | What it does |
|---|---|
| **Proof of pay** | The employer taps "Paid", then the worker taps "I received it". Only then is a **pay slip** created, with a receipt number, both names, hours, overtime, amount and times, shareable on WhatsApp or saved as PDF. "Not received" flags a dispute and lowers the employer's Fair Pay Score. |
| **Wage record** | Earnings this week, this month and in total, from confirmed payments only, plus a downloadable **wage statement** (PDF or CSV) a worker can show for a loan or a government scheme |
| **Works offline** | The app installs on the phone and opens without internet. Pay slips, wage record, saved places and schemes still work. Start, Complete and "I received it" are saved and **sent automatically** when the internet returns. |
| **Breaks the language barrier** | Whole app in **English, Tamil and Hindi**. **Quick messages** ("I have reached", "Take a break and drink water") are stored as a phrase code, so a Hindi-speaking worker and a Tamil-speaking employer each read them in their own language. A 🔊 button reads job requests, payment questions and messages aloud. |

## Ideas taken from Rapido, Urban Company and job apps

Worker Buddy is not a copy of any one app. It takes the parts of each that help daily-wage work:

| Feature | Taken from | What it does here |
|---|---|---|
| Ringing job request, first to accept wins, OTP start | Rapido | The employer books, nearby online workers' phones ring for 30 seconds |
| **Live tracking with arrival time** | Rapido | While the worker is on the way, their pin moves on the employer's map with "2.8 km away · about 13 min"; the worker gets a 🧭 Directions button |
| **Worker can't come → find another** | Rapido | If the worker taps "Can't come", the job goes straight back to other nearby workers, and the employer is told |
| **Cancel with reason** | Rapido / Urban Company | The employer can cancel before work starts |
| **Book for later** | Urban Company | Pick a date and time (for example tomorrow 9 AM). Workers see it under "Jobs for later" and accept any time; a job for later doesn't block today's work |
| **Worker profiles and reviews** | Urban Company | Experience, rating, jobs done, distance, a ✔ Trusted badge (3+ ratings averaging 4+), and review tags such as "⏰ On time ×4" |
| **Choose a worker / Book again** | Urban Company | Tap a worker near you to request only them, or rebook a worker from your history. If they don't accept, send it to everyone |
| **Tips** | Rapido / Urban Company | ₹20 / ₹50 / ₹100 after the job, shown on the pay slip |
| **Workers review the site** | Our own (Glassdoor-style) | Workers tag employers "💧 Gave water", "⛱️ Shade given", "🦺 Safe site". The next worker sees these on the job request before accepting |
| **Share job with family** | Rapido "share ride" | The worker sends the job place, employer name, phone and map link to family on WhatsApp |
| **Counter-offer** | inDrive | On a job request the worker can ask for more (for example ₹530 or ₹550), never above the top of the fair-wage range. The employer sees each offer with the worker's rating and arrival time and picks one |
| **Team booking** | Porter ("add helpers") | "Workers needed: 1–5". Each place rings separately; the employer sees one card per worker with their OTP, and pays each one (each gets their own pay slip) |
| **Rest points hosted by shops** | Zomato rest points | Any employer or shop can offer water, shade, a toilet or phone charging. It shows as 🤝 on every worker's map (nearest first), and their job requests say "Hosts a rest point for workers" |
| **0% commission** | Namma Yatri | Workers keep 100%. Shown on the worker's home screen and on every pay slip |

## Business model (0% commission, like Namma Yatri)

Workers never pay. Ways to keep it running, to discuss on the pitch slide:
- A small flat fee per booking for employers (for example ₹10), not a cut of the wage
- Paid "featured rest point" listings for shops, which bring workers in as customers
- Partnerships with labour welfare boards and NGOs that want verified wage records

## The two apps

| App | Path | Screens |
|---|---|---|
| 👷 **Worker app** | `/worker/` | Home (map, go online, live job, jobs for later) · Earnings · Safety · Schemes |
| 🏠 **Employer app** | `/employer/` | Book (map, choose a worker, now or later, fair wage, live tracking) · Bookings (upcoming, book again) |

## Booking flow

1. Employer posts a job now (or for later) → **Searching** (10 minutes for now; until the chosen time for later), and can share it on WhatsApp
2. Online workers with that skill get a ringing request with a 30-second timer (or only the worker chosen by name)
3. First to accept → **Assigned**; the employer sees the worker moving on the map, the arrival time and a 4-digit OTP. If the worker can't come, it goes back to step 2
4. Worker enters the OTP → **Started**
5. Worker taps Complete → **Completed**, with overtime worked out
6. Employer pays (with an optional tip) → **Paid** → worker confirms → **pay slip**; both rate each other with review tags

## How it is built

| Part | Tool |
|---|---|
| Screens | HTML, CSS, JavaScript (no build step) |
| Live database + real-time updates | [Supabase](https://supabase.com) (free plan) |
| Offline | Service worker (`sw.js`) + saved copies in the browser |
| Maps and nearby places | [Leaflet](https://leafletjs.com), [OpenStreetMap](https://www.openstreetmap.org), Overpass API |
| Weather | [Open-Meteo](https://open-meteo.com) |
| Hosting | [Vercel](https://vercel.com) (free, `vercel.json`, live at https://workerbuddy.vercel.app) or [Render](https://render.com) static site (free, `render.yaml`) |

Database tables: `workers`, `employers`, `bookings`, `messages`, `offers`, `rest_points`, `heat_reports`, `materials`, `favorites`, `repeat_jobs`, `crew_members`, `crew_attendance`. Bookings change state only through database functions (`accept_booking`, `start_booking`, `complete_booking`, `pay_booking`, `confirm_payment`, `cancel_booking`, `worker_cancel`, `review_booking`, `make_offer`, `accept_offer`, `start_at_site`, `rain_stop`, `pay_showup`, `decide_material`, `confirm_by_qr`). The SQL is in `supabase/`.

## Safety and privacy

| What | How |
|---|---|
| **Real accounts** | A switch (`app_settings.require_verified`) makes posting and taking jobs need Google or a verified mobile number. The profile phone comes from the verified number |
| **Limits** | About 6 job posts an hour, 20 offers in 10 minutes and 10 reports a day per account |
| **Report and block** | ⚠️ on every live job, both apps. A block hides that employer's jobs and stops the pair working together. Three people reporting one account put it on hold for 7 days |
| **Admins** | `/admin/` lists reports, with suspend, lift hold and close |
| **Privacy** | A notice in 3 languages before first use, consent saved per account, `/privacy/` page, download my data, delete my account, old locations wiped every night |
| **Backups** | Nightly encrypted copy (`.github/workflows/backup.yml`); see `docs/BACKUP-AND-RESTORE.md` |
| **Tests** | `supabase/tests/run.sh` on every pull request |

Steps done by hand in the dashboards are in `docs/LAUNCH-CHECKLIST.md`.

## Run it on your laptop

```bash
python -m http.server 5500
```

Open http://localhost:5500. For the live demo, open `/employer/` on one phone or window and `/worker/` on another.

## Host it on Render

`render.yaml` sets the app up as a Render static site with the same security headers as `vercel.json`. A static site on Render stays awake; only Render's free web services sleep.

1. In the Render dashboard: **New → Blueprint**, pick this repo, and apply. Render reads `render.yaml`, publishes the repo as it is (no build) and gives an address like `https://worker-buddy.onrender.com`.
2. Add that address to Supabase's redirect URLs (see step 1 under **Switch on Google and mobile number sign-in**), or Google sign-in will not come back to the app.
3. Every push to `main` deploys again, and each pull request gets its own preview address.

Keep the headers in `render.yaml` and `vercel.json` the same while both are in use.

## Demo script (3 minutes)

1. **Worker phone:** open `/worker/`, pick **हिंदी**, sign up as an Electrician, tap **Go online**.
2. **Employer phone:** open `/employer/`, pick **தமிழ்**, sign up, pick Electrician, type *Guindy*, tap **Post job** (it also shows **📲 Share job on WhatsApp**).
3. The worker phone rings. Tap 🔊 to hear the job, then tap **Accept** or press 🎤 and say "accept".
4. Worker taps **"I have reached"**. The employer sees it **in Tamil**.
5. Worker enters the OTP and taps **Start work**. Optional: turn on airplane mode first to show it saves and syncs.
6. Worker taps **Complete job**. The employer taps **Pay**.
7. Worker taps **Yes, I received it** and the **pay slip** appears. Open **Earnings** and download the wage statement.
8. Both rate each other with tags. Employer opens **Bookings**, taps **🔁 Book again**, picks **Later** (tomorrow 9 AM). The worker sees it under **Jobs for later** and accepts.
9. Employer books another job now: the worker's request shows **💧 Gave water ×1** from the last review.
10. On that request the worker taps **₹550** under "Ask for more". The employer sees the offer and taps **Accept ₹550**.
11. Employer opens **Bookings** and saves a **rest point** (water + shade). The worker's **Safety** map shows it at the top with 🤝.
12. Employer sets **Workers needed: 3** and books. Each worker who accepts fills one place on the team card.

## Files

| File | What it does | Owner |
|---|---|---|
| `index.html` | Home page: choose an app | Member 4 |
| `worker/index.html`, `js/worker-app.js` | Worker app | Member 1 |
| `employer/index.html`, `js/employer-app.js` | Employer app | Member 2 |
| `js/features.js` | Proof of pay, wage record, offline queue, quick messages, read-aloud, nearby places | Member 4 |
| `js/lang-hi.js` | Hindi text | Member 1 |
| `js/fair.js` | Show-up pay, UPI pay QR, travel, rain-off, tools, materials, meal/water tags, SMS slips | Member 2 |
| `js/care.js` | Rights helper, 18+, night jobs, site check-in, migrants, ration/stay/crèche finders | Member 3 |
| `js/grow.js` | Crew book, lessons, availability, cover, favourites, monthly report, repeat jobs, shared phone | Member 1 |
| `js/pages.js`, `wages/`, `dispute/` | Wage map and dispute room pages | Member 3 |
| `js/deck.js` | The deck flow: WhatsApp job links, voice commands, skill badges, welfare rating, rate card, heat alerts, impact numbers (all 3 languages) | Member 4 |
| `js/more.js` | Counter-offers, team booking, rest points, 0% commission (all 3 languages) | Member 3 |
| `js/extras.js` | Tracking, book for later, profiles and reviews, tips, share with family (all 3 languages) | Member 2 |
| `js/safety.js` | Heat alert, rest map, SOS, scheme finder | Member 3 |
| `js/wage.js` | Fair-wage engine | Member 2 |
| `js/live.js` | Database connection, booking helpers, popups | Member 4 |
| `js/data.js` | Work types, places, schemes, English/Tamil text | Member 4 |
| `js/config.js` | Supabase address and publishable key | Member 4 |
| `js/trust.js` | Privacy notice and consent, report and block, download or delete my data | Member 4 |
| `js/countries.js` | Country packs: money in the local currency, phone numbers in international form, local date and speech language | Member 4 |
| `privacy/` | Privacy notice and terms (English, Tamil, Hindi) | Member 4 |
| `admin/` | Reports and suspensions, for admins only | Member 4 |
| `supabase/tests/` | Builds the database from every migration and checks the safety rules (runs on every pull request) | Member 4 |
| `docs/` | Launch checklist, backups and restore | Member 4 |
| `sw.js` | Offline support | Member 4 |
| `supabase/*.sql` | Database tables and functions | Member 4 |
| `css/style.css`, `css/live.css` | Look and layout | Member 4 |

**After changing any file,** raise `VERSION` in `sw.js` (for example `wb-v2`) so phones pick up the new version.

## Switch on Google and mobile number sign-in

The buttons are built in; they say "not switched on yet" until these are set in the Supabase dashboard.

1. **Authentication → URL Configuration:** Site URL `https://workerbuddy.vercel.app`; add redirect URLs `https://workerbuddy.vercel.app/**`, `https://worker-buddy-app.vercel.app/**` (the old address still works), `https://worker-buddy.onrender.com/**` (or whatever address Render gives the site) and `http://localhost:5500/**`. Google sign-in returns to the address the app is on, so every address the app runs on must be in this list.
2. **Authentication → Sign In / Providers → Allow manual linking:** on (lets a phone's account add Google without losing its profile).
3. **Google:** in Google Cloud Console make an OAuth client (Web application) with the redirect URI `https://ndvnvalwbtqgutpfsqfa.supabase.co/auth/v1/callback`, then paste its client ID and secret into **Providers → Google** and switch it on. Free.
4. **Phone:** switch on **Providers → Phone** and fill in an SMS provider (Twilio, MessageBird, Vonage or Textlocal). Real SMS costs money and Indian numbers need DLT registration. For a demo, add test numbers with fixed codes under **Phone → Test phone numbers and OTPs** (for example `919000000001=123456`), so no SMS is sent.

## Limits of this prototype

- **Accounts:** each phone signs in once with Supabase anonymous sign-in (no password or SMS) and owns the profiles it creates. Every action is checked in the database (`assert_mine`), the OTP lives in a private table only that job's employer can read, and 5 wrong OTPs lock the code until the employer makes a new one. Users can add **Google** or a **mobile number (SMS OTP)** to that account (`js/account.js`), then sign in on a new phone or after clearing the browser to get the same profile, jobs and pay slips back. Without one of those, clearing the browser's data loses the account.
- **Private details** (`supabase/016_private_data_and_fair_pay.sql`): phone numbers, UPI IDs and exact locations can't be read from the profile tables. Other people's profiles come from `workers_public` / `employers_public` (no phone, location rounded to about 1 km). The phone and live location of the person on your own job come from `job_contacts`. Jobs, messages, offers, crew lists and the rest are readable only by the people on them. Worker rows are no longer sent live, so the employer's map refreshes every 15 seconds.
- **Minimum wage:** the floor is ₹610 a day. The Tamil Nadu rate for construction or maintenance of roads and buildings was ₹606.60 (basic ₹117 + VDA ₹489.60) up to March 2026, per WageIndicator. The VDA from 1 Apr 2026 comes from notification Z3/3459/2026, whose rupee amounts aren't published online (₹609.30 was reported); ₹610 is above both. No per-trade figure was found, so every trade uses it. Update `MIN_WAGE_DAY` in `js/data.js` and the `min_wages` table together. The database raises any job posted below it.
- **Payment:** the employer's own UPI app opens with the worker's UPI ID and the amount filled in (`upi://pay`, free). The payment itself is not checked automatically; both sides still confirm in Worker Buddy. A payment gateway with auto-confirm needs business KYC.
- **Nearby places:** shared through the database for 7 days per ~1 km area (`places_cache`), so only the first lookup in an area asks the free Overpass servers. Two servers are asked at once; if both are down and nobody has looked up the area before, saved places are shown. Phones can't write to the cache directly (`supabase/017_places_cache_writes.sql`): `save_places` keeps only name, position and kind, rejects places far from the area, and never replaces an answer less than 7 days old.
- **Offline:** a new job is saved on the employer's phone and posted when the internet returns ("post now" jobs older than an hour are dropped so no stale job rings workers). The worker's in-job actions are saved offline too.
- The rights helper matches keywords (works offline); it is not an AI model yet.
- **Maps:** the in-app maps use free OpenStreetMap tiles. Every place (job site, rest points, water, shade, tea, toilets, services) has a 🧭 Directions link that opens Google Maps with the route. Showing Google's own map inside the app needs a Google Maps API key with billing turned on.
- GST numbers are checked for the right format only, not with the GST portal.
- **Repeat jobs** are created by the server every 10 minutes (`pg_cron`), even if the employer never opens the app.
- The ₹2/day accident cover is an idea for a partner insurer; it is not active.
- Voice commands use the phone browser's speech recognition (Chrome on Android works best); it needs internet.
- ITI numbers are self-declared and marked "to verify" until a partner checks them.
- **Arrival time** uses the road distance from the free OSRM router at city speed (falls back to straight-line distance if the router does not answer).
- Scheme eligibility is simplified; the app tells users to confirm on the official website.
- Translations should be checked by a native Tamil and Hindi speaker.
