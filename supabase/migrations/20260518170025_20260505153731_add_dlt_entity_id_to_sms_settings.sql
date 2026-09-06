/*
  # Add DLT Entity ID to SMS Settings

  1. Modified Tables
    - `sms_settings`
      - `dlt_entity_id` (text, default '') - DLT Principal Entity ID (PE ID) registered with TRAI for DLT-compliant messaging

  2. Important Notes
    - Required for TRAI DLT-approved message sending via Fast2SMS, MSG91, SMSGatewayHub
    - Existing rows get empty string default
    - No data is dropped or deleted
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'sms_settings' AND column_name = 'dlt_entity_id'
  ) THEN
    ALTER TABLE sms_settings ADD COLUMN dlt_entity_id text NOT NULL DEFAULT '';
  END IF;
END $$;