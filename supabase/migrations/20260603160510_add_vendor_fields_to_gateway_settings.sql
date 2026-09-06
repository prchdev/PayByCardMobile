/*
  # Add vendor/linked account fields to payment_gateway_settings and beneficiaries

  ## Changes

  ### payment_gateway_settings
  - `razorpay_account_number` (text) — RazorPay X account number used for payouts (e.g. "2323230082985xxx")
  - `cashfree_client_id` (text) — CashFree Payout API client ID (separate from payment client ID)
  - `cashfree_client_secret` (text) — CashFree Payout API client secret

  ### beneficiaries
  - `razorpay_contact_id` (text) — cached RazorPay contact ID for this beneficiary
  - `razorpay_fund_account_id` (text) — cached RazorPay fund account ID for this beneficiary
  - `cashfree_bene_id` (text) — cached CashFree beneficiary/vendor ID

  ## Notes
  These fields cache the vendor registration IDs so we do a GET (check existence) before POST,
  avoiding duplicate-creation errors and reducing API round-trips on subsequent payouts.
*/

DO $$
BEGIN
  -- payment_gateway_settings additions
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payment_gateway_settings' AND column_name='razorpay_account_number') THEN
    ALTER TABLE payment_gateway_settings ADD COLUMN razorpay_account_number text DEFAULT '';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payment_gateway_settings' AND column_name='cashfree_payout_client_id') THEN
    ALTER TABLE payment_gateway_settings ADD COLUMN cashfree_payout_client_id text DEFAULT '';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='payment_gateway_settings' AND column_name='cashfree_payout_client_secret') THEN
    ALTER TABLE payment_gateway_settings ADD COLUMN cashfree_payout_client_secret text DEFAULT '';
  END IF;

  -- beneficiaries additions
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='beneficiaries' AND column_name='razorpay_contact_id') THEN
    ALTER TABLE beneficiaries ADD COLUMN razorpay_contact_id text DEFAULT '';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='beneficiaries' AND column_name='razorpay_fund_account_id') THEN
    ALTER TABLE beneficiaries ADD COLUMN razorpay_fund_account_id text DEFAULT '';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='beneficiaries' AND column_name='cashfree_bene_id') THEN
    ALTER TABLE beneficiaries ADD COLUMN cashfree_bene_id text DEFAULT '';
  END IF;
END $$;
