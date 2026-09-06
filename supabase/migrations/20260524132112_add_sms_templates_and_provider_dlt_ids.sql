/*
  # Add SMS Templates and Additional DLT Template IDs

  ## Summary
  Extends the SMS settings infrastructure to support:

  1. **sms_settings table** — new SMS message template columns:
     - Critical Service Messages (OTP-type): `tpl_otp`, `tpl_merchant_onboarding`
     - Optional Service Messages (Transactional-type): `tpl_kyc_approved`, `tpl_kyc_rejected`,
       `tpl_payment_settled`, `tpl_payment_refund`, `tpl_payment_initiated`

  2. **sms_provider_settings table** — rename/add per-provider DLT Content Template IDs:
     - `transactional_template_id` → now used for Merchant Onboarding (renamed in UI only; column kept for compatibility)
     - New columns: `dlt_kyc_approved`, `dlt_kyc_rejected`, `dlt_payment_initiated`,
       `dlt_payment_settled`, `dlt_payment_refund`

  ## Notes
  - All new columns default to empty string to avoid breaking existing rows.
  - The `transactional_template_id` column is repurposed as the Merchant Onboarding DLT ID (no data loss).
*/

-- Add SMS message template columns to sms_settings
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sms_settings' AND column_name = 'tpl_otp') THEN
    ALTER TABLE sms_settings ADD COLUMN tpl_otp text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sms_settings' AND column_name = 'tpl_merchant_onboarding') THEN
    ALTER TABLE sms_settings ADD COLUMN tpl_merchant_onboarding text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sms_settings' AND column_name = 'tpl_kyc_approved') THEN
    ALTER TABLE sms_settings ADD COLUMN tpl_kyc_approved text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sms_settings' AND column_name = 'tpl_kyc_rejected') THEN
    ALTER TABLE sms_settings ADD COLUMN tpl_kyc_rejected text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sms_settings' AND column_name = 'tpl_payment_settled') THEN
    ALTER TABLE sms_settings ADD COLUMN tpl_payment_settled text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sms_settings' AND column_name = 'tpl_payment_refund') THEN
    ALTER TABLE sms_settings ADD COLUMN tpl_payment_refund text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sms_settings' AND column_name = 'tpl_payment_initiated') THEN
    ALTER TABLE sms_settings ADD COLUMN tpl_payment_initiated text NOT NULL DEFAULT '';
  END IF;
END $$;

-- Add additional DLT Content Template ID columns to sms_provider_settings
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sms_provider_settings' AND column_name = 'dlt_kyc_approved') THEN
    ALTER TABLE sms_provider_settings ADD COLUMN dlt_kyc_approved text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sms_provider_settings' AND column_name = 'dlt_kyc_rejected') THEN
    ALTER TABLE sms_provider_settings ADD COLUMN dlt_kyc_rejected text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sms_provider_settings' AND column_name = 'dlt_payment_initiated') THEN
    ALTER TABLE sms_provider_settings ADD COLUMN dlt_payment_initiated text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sms_provider_settings' AND column_name = 'dlt_payment_settled') THEN
    ALTER TABLE sms_provider_settings ADD COLUMN dlt_payment_settled text NOT NULL DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sms_provider_settings' AND column_name = 'dlt_payment_refund') THEN
    ALTER TABLE sms_provider_settings ADD COLUMN dlt_payment_refund text NOT NULL DEFAULT '';
  END IF;
END $$;
