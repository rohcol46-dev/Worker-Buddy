-- 009: the worker's UPI ID, so the employer's own UPI app opens with the wage filled in
alter table public.workers add column upi_id text
  check (upi_id is null or upi_id ~ '^[A-Za-z0-9._-]{2,64}@[A-Za-z]{2,64}$');
