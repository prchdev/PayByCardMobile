/*
  # Create digilocker_logs table

  Captures every DigiLocker API call attempt — both user KYC and merchant KYC flows.
  Stores the action, provider used, HTTP status of each external call, the full raw
  response body (for debugging), and any error messages.

  1. New Tables
    - `digilocker_logs`
      - `id` (uuid, pk)
      - `user_id` (uuid, nullable — user KYC flow)
      - `merchant_id` (uuid, nullable — merchant KYC flow)
      - `flow` (text) — 'user' | 'merchant'
      - `action` (text) — 'get_auth_url' | 'check_status' | 'auto_approve' | 'token_exchange' | 'fetch_docs' | 'fetch_aadhaar' | 'fetch_pan'
      - `provider` (text)
      - `environment` (text)
      - `http_status` (int, nullable) — HTTP status from DigiLocker/CashFree API
      - `success` (bool)
      - `error_code` (text, nullable)
      - `error_message` (text, nullable)
      - `raw_request` (jsonb, nullable) — sanitized request params (no secrets)
      - `raw_response` (jsonb, nullable) — full API response body
      - `duration_ms` (int, nullable) — how long the external call took
      - `created_at` (timestamptz)

  2. Security
    - RLS enabled; only service role can read/write
*/

CREATE TABLE IF NOT EXISTS digilocker_logs (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        REFERENCES users(id) ON DELETE SET NULL,
  merchant_id   uuid        REFERENCES merchant_onboarding(id) ON DELETE SET NULL,
  flow          text        NOT NULL CHECK (flow IN ('user', 'merchant')),
  action        text        NOT NULL,
  provider      text        NOT NULL DEFAULT '',
  environment   text        NOT NULL DEFAULT '',
  http_status   int,
  success       boolean     NOT NULL DEFAULT false,
  error_code    text,
  error_message text,
  raw_request   jsonb,
  raw_response  jsonb,
  duration_ms   int,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS digilocker_logs_user_id_idx       ON digilocker_logs (user_id);
CREATE INDEX IF NOT EXISTS digilocker_logs_merchant_id_idx   ON digilocker_logs (merchant_id);
CREATE INDEX IF NOT EXISTS digilocker_logs_created_at_idx    ON digilocker_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS digilocker_logs_success_idx       ON digilocker_logs (success);

ALTER TABLE digilocker_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can insert digilocker logs"
  ON digilocker_logs FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Service role can select digilocker logs"
  ON digilocker_logs FOR SELECT
  TO service_role
  USING (true);
