-- Add last_batch_sent_at to both campaign tables for hourly rate limiting.
-- The cron job uses this to calculate how many emails/SMS can be sent in the current cycle
-- based on the hourly_rate setting (e.g. 100/hour = ~8 per 5-minute cron cycle).

ALTER TABLE bulk_email_campaigns
  ADD COLUMN IF NOT EXISTS last_batch_sent_at timestamptz;

ALTER TABLE bulk_sms_campaigns
  ADD COLUMN IF NOT EXISTS last_batch_sent_at timestamptz;
