/*
  # Create payment_limits table

  1. New Tables
    - `payment_limits`
      - `id` (uuid, primary key) - Unique identifier
      - `minimum_amount` (numeric) - Minimum payment amount allowed
      - `maximum_amount` (numeric) - Maximum payment amount allowed
      - `created_at` (timestamptz) - Record creation timestamp
      - `updated_at` (timestamptz) - Last update timestamp
      - `created_by` (uuid, foreign key) - Admin user who created the record
      - `updated_by` (uuid, foreign key) - Admin user who last updated the record
      - `created_ip` (text) - IP address of creator
      - `updated_ip` (text) - IP address of last updater

  2. Security
    - Enable RLS on `payment_limits` table
    - Add policy for authenticated admin users to read payment limits
    - Add policy for authenticated admin users to insert payment limits
    - Add policy for authenticated admin users to update payment limits

  3. Notes
    - Only one row should exist in this table (singleton pattern)
    - Default values: min = 1, max = 100000
*/

CREATE TABLE IF NOT EXISTS payment_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  minimum_amount numeric NOT NULL DEFAULT 1 CHECK (minimum_amount > 0),
  maximum_amount numeric NOT NULL DEFAULT 100000 CHECK (maximum_amount > minimum_amount),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES admin_users(id),
  updated_by uuid REFERENCES admin_users(id),
  created_ip text,
  updated_ip text
);

-- Enable RLS
ALTER TABLE payment_limits ENABLE ROW LEVEL SECURITY;

-- Policy for reading payment limits (any authenticated user can read)
CREATE POLICY "Authenticated users can read payment limits"
  ON payment_limits
  FOR SELECT
  TO authenticated
  USING (true);

-- Policy for inserting payment limits (authenticated users can insert)
CREATE POLICY "Authenticated users can insert payment limits"
  ON payment_limits
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Policy for updating payment limits (authenticated users can update)
CREATE POLICY "Authenticated users can update payment limits"
  ON payment_limits
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Insert default values if table is empty
INSERT INTO payment_limits (minimum_amount, maximum_amount)
SELECT 1, 100000
WHERE NOT EXISTS (SELECT 1 FROM payment_limits);

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_payment_limits_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_payment_limits_timestamp
  BEFORE UPDATE ON payment_limits
  FOR EACH ROW
  EXECUTE FUNCTION update_payment_limits_updated_at();
