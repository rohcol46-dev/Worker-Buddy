# Adding a country

Worker Buddy launches city by city. A country is one row in `public.countries` and six rows in
`public.min_wages`. Run these in the Supabase SQL editor. Nothing in the app code changes.

1. **Add the country, not yet open:**

   ```sql
   insert into public.countries (code, name, live, currency, calling_code, phone_pattern, phone_example,
                                 time_zone, emergency, languages, wage_region, pay_rules)
   values ('KE', 'Kenya', false, 'KES', '254', '[17][0-9]{8}', '712345678', 'Africa/Nairobi', '999', '{en,sw}', 'Nairobi',
     '{"round": 10, "overtime": 1.5, "short_min": 0.5, "showup": 200, "tools": 100, "load_medium": 100,
       "load_heavy": 200, "risky": 200, "travel_free_km": 5, "travel_base": 100, "travel_per_km": 20,
       "travel_max": 300, "night": 0.2, "heat": 0.1, "offer_step": 100}');
   ```

   These numbers are an example, not Kenya's real rules. Check the local labour law for each one.

2. **Add the legal minimum day wage and the going rate for all six trades.** These are coolie,
   helper, plumber, electrician, mason and painter. Write the law or notice you took the rate from in `source`:

   ```sql
   insert into public.min_wages (country, type, day_rate, est_min, est_max, source, effective_from) values
     ('KE', 'coolie', 400, 450, 600, '<law or notice>', '2026-01-01'), ...;
   ```

3. **Open it:** `update public.countries set live = true where code = 'KE';`
   The database refuses this if any pay rule or trade is missing. Once a country has jobs, it keeps
   its pay rules and minimum wages even if you set `live` back to false.

## Pay rules

| Key | What it does | India |
|---|---|---|
| `round` | Amounts are whole steps of this | 10 |
| `overtime` | Each hour past 8 is paid at this many times the hourly rate | 2 |
| `short_min` | A short job pays at least this share of a day | 0.5 |
| `showup` | Paid when the employer cancels after the worker set off | 100 |
| `tools` | Extra when the worker brings their own tools | 50 |
| `load_medium`, `load_heavy` | Extra for medium or heavy work | 50, 100 |
| `risky` | Extra for work at height, with electricity, or in sewers | 100 |
| `travel_free_km`, `travel_base`, `travel_per_km`, `travel_max` | Travel allowance: nothing up to `travel_free_km`, then `travel_base` plus `travel_per_km` for each further km, up to `travel_max` | 5, 50, 10, 150 |
| `night`, `heat` | Extra share for night work and for hot days | 0.2, 0.1 |
| `offer_step` | A worker's counter-offer can be one or two steps above the posted wage | 50 |

## Not covered yet

- A job's country comes from the employer's profile, not from where the job is.
- Welfare schemes, helplines and the privacy notice are written for India.
