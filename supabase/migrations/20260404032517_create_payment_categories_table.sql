/*
  # Create Payment Categories Table

  1. New Tables
    - `payment_categories`
      - `id` (uuid, primary key)
      - `category_name` (text) - Name of the payment category
      - `is_enabled` (boolean) - Whether this payment method is enabled
      - `terms_and_conditions` (text) - Rich text content for T&C
      - `charges_percentage` (decimal) - Base charges in percentage
      - `show_discount` (boolean) - Whether discount is enabled
      - `discounted_charges_percentage` (decimal) - Discounted charges if applicable
      - `gst_percentage` (decimal) - GST charges percentage
      - `updated_by_admin_id` (uuid) - Admin who last modified this
      - `updated_by_ip` (text) - IP address of the modifier
      - `created_at` (timestamptz) - Creation timestamp
      - `updated_at` (timestamptz) - Last update timestamp

  2. Security
    - Enable RLS on `payment_categories` table
    - Add policy for authenticated users (admins only via edge function)

  3. Initial Data
    - Insert 4 default payment categories with default values
*/

-- Create payment_categories table
CREATE TABLE IF NOT EXISTS payment_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_name text UNIQUE NOT NULL,
  is_enabled boolean DEFAULT false,
  terms_and_conditions text DEFAULT '',
  charges_percentage decimal(5,2) DEFAULT 0.00,
  show_discount boolean DEFAULT false,
  discounted_charges_percentage decimal(5,2) DEFAULT 0.00,
  gst_percentage decimal(5,2) DEFAULT 18.00,
  updated_by_admin_id uuid REFERENCES auth.users(id),
  updated_by_ip text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE payment_categories ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Allow service role full access to payment_categories"
  ON payment_categories
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Insert default payment categories
INSERT INTO payment_categories (category_name, terms_and_conditions) VALUES
  ('Visa/Master/Rupay Card', 'Standard payment processing terms and conditions apply.'),
  ('Visa/Master/Rupay Card - Instant Settlement', 'Instant settlement with expedited processing. Additional terms may apply.'),
  ('American Express/Diners Club Card', 'Premium card processing with standard settlement terms.'),
  ('American Express/Diners Club Card - Instant Settlement', 'Premium card processing with instant settlement capabilities.')
ON CONFLICT (category_name) DO NOTHING;