/*
# Add 6-month expiry to push tokens

1. Modified Tables
- `mobile_push_tokens`: Added `expires_at` (timestamptz, nullable) column to track when a token expires.
  - On insert, defaults to `now() + interval '6 months'` so tokens auto-expire after 6 months.
  - On update (reactivation), the edge function sets `expires_at` to 6 months from now.
2. Backfill
- Existing active tokens get `expires_at = created_at + interval '6 months'` so they follow the same rule.
3. Security
- No RLS policy changes — this table is accessed only via the service-role key in edge functions.
4. Important Notes
- The `register-push-token` edge function now sets `expires_at` to `now() + interval '6 months'` on both insert and reactivation.
- The `send-push-notification` edge function now filters out tokens where `expires_at < now()` in addition to `is_active = true`.
*/

ALTER TABLE mobile_push_tokens
  ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- Backfill existing rows: 6 months from created_at
UPDATE mobile_push_tokens
  SET expires_at = created_at + interval '6 months'
  WHERE expires_at IS NULL;

-- Set default for future inserts
ALTER TABLE mobile_push_tokens
  ALTER COLUMN expires_at SET DEFAULT now() + interval '6 months';