/*
  # Add Audit Tracking and Payment Charges to Payment Gateway Settings

  1. Changes to `payment_gateway_settings` table
    - Add `updated_ip` (text) - IP address of admin who last updated the record
    - Add `instant_settlement_charges` (jsonb) - Charges for instant settlement per card type with percentage
    - Add `normal_settlement_charges` (jsonb) - Charges for normal settlement per card type with percentage
    - Add `gst_percentage` (numeric) - GST percentage to be applied on charges
    - Modify `is_enabled` default to false

  2. Notes
    - Audit tracking now includes IP address for security compliance
    - Payment charges are stored as JSON with card type as key and percentage as value
    - GST is calculated on top of the base charges
    - Example charge structure: {"Visa": 2.5, "MasterCard": 2.3, "Rupay": 1.8}
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_gateway_settings' AND column_name = 'updated_ip'
  ) THEN
    ALTER TABLE payment_gateway_settings ADD COLUMN updated_ip text DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_gateway_settings' AND column_name = 'instant_settlement_charges'
  ) THEN
    ALTER TABLE payment_gateway_settings ADD COLUMN instant_settlement_charges jsonb DEFAULT '{}'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_gateway_settings' AND column_name = 'normal_settlement_charges'
  ) THEN
    ALTER TABLE payment_gateway_settings ADD COLUMN normal_settlement_charges jsonb DEFAULT '{}'::jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_gateway_settings' AND column_name = 'gst_percentage'
  ) THEN
    ALTER TABLE payment_gateway_settings ADD COLUMN gst_percentage numeric(5,2) DEFAULT 18.00;
  END IF;
END $$;

ALTER TABLE payment_gateway_settings 
  ALTER COLUMN is_enabled SET DEFAULT false;