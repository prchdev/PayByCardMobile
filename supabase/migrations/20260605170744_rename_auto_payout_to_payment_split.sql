UPDATE payment_gateway_settings
SET payout_mode = 'payment_split'
WHERE payout_mode = 'auto';