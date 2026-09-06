/*
  # Create Payment Categories Table

  1. New Tables
    - `payment_categories`
      - `id` (uuid, primary key) - Unique identifier
      - `category_name` (text) - Name of the payment category
      - `is_enabled` (boolean) - Whether this category is active
      - `display_order` (integer) - Order for displaying categories
      - `created_at` (timestamptz) - Creation timestamp
      - `updated_at` (timestamptz) - Last update timestamp

  2. Security
    - Enable RLS on `payment_categories` table
    - Add policy for service role access

  3. Initial Data
    - Insert predefined payment categories
*/

CREATE TABLE IF NOT EXISTS payment_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_name text UNIQUE NOT NULL,
  is_enabled boolean DEFAULT true,
  display_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE payment_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service role full access to payment_categories"
  ON payment_categories
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

INSERT INTO payment_categories (category_name, is_enabled, display_order) VALUES
  ('Business Payment', true, 1),
  ('Interior Designer Payment', true, 2),
  ('Utility Payment', true, 3),
  ('Freelancer Payment', true, 4),
  ('School & Tuition Fees Payment', true, 5),
  ('Club Membership Payment', true, 6),
  ('Supplier Payment', true, 7),
  ('Tax Payment', true, 8),
  ('Account Fees Payment', true, 9),
  ('Housing Maintenance Payment', true, 10),
  ('Professional Services Payment', true, 11),
  ('House Maintenance Services Payment', true, 12),
  ('Vendor Payment', true, 13),
  ('Event Planner Payment', true, 14),
  ('Legal & Lawyers Fees Payment', true, 15)
ON CONFLICT (category_name) DO NOTHING;
