/*
# Create Bulk Email and Bulk SMS Campaign Tables

## Purpose
Stores bulk email and SMS campaigns composed by admins, with recipient filters,
scheduling, hourly rate limiting, and delivery tracking. Supports parameterized
fields ({first_name}, {middle_name}, {last_name}) in subject/body.

## New Tables

### bulk_email_campaigns
- id (uuid PK)
- campaign_name (text) — admin-given name
- subject (text) — email subject, supports {first_name} etc.
- body_html (text) — rich HTML email body, supports parameters
- recipient_filter (text) — one of: all_users, kyced_users, kyced_no_payment, non_kyced_users, kyced_no_payment_x_days
- filter_days (integer) — for kyced_no_payment_x_days filter, the X days value
- hourly_rate (integer) — max emails per hour
- status (text) — draft, scheduled, sending, completed, failed, cancelled
- scheduled_at (timestamptz) — when to start sending (null = immediate)
- total_recipients (integer) — computed at send time
- sent_count (integer) — running count
- failed_count (integer)
- started_at (timestamptz)
- completed_at (timestamptz)
- created_by_admin_id (text)
- created_at, updated_at (timestamptz)

### bulk_sms_campaigns
- id (uuid PK)
- campaign_name (text)
- message (text) — SMS body, supports {first_name} etc.
- recipient_filter (text) — same filters as email
- filter_days (integer)
- hourly_rate (integer)
- status (text) — draft, scheduled, sending, completed, failed, cancelled
- scheduled_at (timestamptz)
- total_recipients (integer)
- sent_count (integer)
- failed_count (integer)
- started_at (timestamptz)
- completed_at (timestamptz)
- created_by_admin_id (text)
- created_at, updated_at (timestamptz)

### bulk_campaign_recipients
- Tracks per-recipient delivery status for both email and SMS campaigns.
- id (uuid PK)
- campaign_type (text) — 'email' or 'sms'
- campaign_id (uuid FK)
- user_id (uuid) — references users table
- email_or_phone (text) — the address sent to
- status (text) — pending, sent, failed
- sent_at (timestamptz)
- error_message (text)
- created_at (timestamptz)

## Security
- RLS enabled on all tables.
- Service role only (admin edge functions use service role key which bypasses RLS).
- No direct anon/authenticated access — all operations go through admin edge functions.
*/

CREATE TABLE IF NOT EXISTS bulk_email_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_name text NOT NULL,
  subject text NOT NULL,
  body_html text NOT NULL DEFAULT '',
  recipient_filter text NOT NULL DEFAULT 'all_users',
  filter_days integer DEFAULT 0,
  hourly_rate integer NOT NULL DEFAULT 100,
  status text NOT NULL DEFAULT 'draft',
  scheduled_at timestamptz,
  total_recipients integer DEFAULT 0,
  sent_count integer DEFAULT 0,
  failed_count integer DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_by_admin_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE bulk_email_campaigns ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS bulk_sms_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_name text NOT NULL,
  message text NOT NULL DEFAULT '',
  recipient_filter text NOT NULL DEFAULT 'all_users',
  filter_days integer DEFAULT 0,
  hourly_rate integer NOT NULL DEFAULT 100,
  status text NOT NULL DEFAULT 'draft',
  scheduled_at timestamptz,
  total_recipients integer DEFAULT 0,
  sent_count integer DEFAULT 0,
  failed_count integer DEFAULT 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_by_admin_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE bulk_sms_campaigns ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS bulk_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_type text NOT NULL,
  campaign_id uuid NOT NULL,
  user_id uuid,
  email_or_phone text,
  status text NOT NULL DEFAULT 'pending',
  sent_at timestamptz,
  error_message text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE bulk_campaign_recipients ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_bulk_campaign_recipients_campaign
  ON bulk_campaign_recipients(campaign_type, campaign_id, status);
