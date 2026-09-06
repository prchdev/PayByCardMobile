ALTER TABLE payment_options ADD COLUMN IF NOT EXISTS gateway_id uuid REFERENCES payment_gateway_settings(id) ON DELETE SET NULL;
ALTER TABLE payment_options ADD COLUMN IF NOT EXISTS environment text DEFAULT 'test';
