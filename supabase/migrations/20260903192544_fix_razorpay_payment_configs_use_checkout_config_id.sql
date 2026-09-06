ALTER TABLE razorpay_payment_configs DROP COLUMN IF EXISTS method;
ALTER TABLE razorpay_payment_configs DROP COLUMN IF EXISTS allowed_card_types;
ALTER TABLE razorpay_payment_configs ADD COLUMN IF NOT EXISTS checkout_config_id text;
