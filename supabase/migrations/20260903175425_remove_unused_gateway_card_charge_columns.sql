/*
# Remove unused card charge and payout charge columns from payment_gateway_settings

1. Removed Columns
- `visa_charges` — card-specific charge percentage for Visa; never used in charge calculations (charges come from payment_options table)
- `mastercard_charges` — card-specific charge percentage for MasterCard; never used
- `rupay_charges` — card-specific charge percentage for RuPay; never used
- `amex_charges` — card-specific charge percentage for American Express; never used
- `diners_charges` — card-specific charge percentage for Diners Club; never used
- `payout_charges_inr` — flat fee per payout transaction; never read by any payout function
- `instant_settlement_charges` — JSONB object of per-card instant settlement charges; payout functions use `instant_settlement_charges_percentage` column instead
- `normal_settlement_charges` — legacy column, not used anywhere

2. Important Notes
- These columns contained admin-configured charge percentages that were never consumed by any business logic.
- Actual payment charges are computed from the `payment_options` table, not from gateway-level card charges.
- Instant settlement charges use the `instant_settlement_charges_percentage` numeric column, not the JSONB `instant_settlement_charges` column.
- The `gst_percentage` column is retained as it IS used in charge calculations.
- No user data is lost — these are configuration-only columns with no user-facing data.
*/

ALTER TABLE payment_gateway_settings
  DROP COLUMN IF EXISTS visa_charges,
  DROP COLUMN IF EXISTS mastercard_charges,
  DROP COLUMN IF EXISTS rupay_charges,
  DROP COLUMN IF EXISTS amex_charges,
  DROP COLUMN IF EXISTS diners_charges,
  DROP COLUMN IF EXISTS payout_charges_inr,
  DROP COLUMN IF EXISTS instant_settlement_charges,
  DROP COLUMN IF EXISTS normal_settlement_charges;
