/*
  # Create beneficiaries table

  1. New Tables
    - `beneficiaries`
      - `id` (uuid, primary key) - Unique identifier for each beneficiary
      - `user_id` (uuid, foreign key) - References the user who added this beneficiary
      - `full_name` (text) - Full name of the beneficiary
      - `bank_account` (text) - Bank account number
      - `ifsc` (text) - IFSC code
      - `bank_name` (text) - Name of the bank (derived from IFSC)
      - `branch_name` (text) - Name of the branch (derived from IFSC)
      - `account_type` (text) - Account type (Saving/Current)
      - `email` (text) - Email address of beneficiary
      - `mobile` (text) - Mobile number of beneficiary
      - `pan_number` (text, optional) - PAN number (optional field)
      - `status` (text) - Status of beneficiary (Active/Inactive), default Active
      - `created_at` (timestamptz) - When the beneficiary was created
      - `updated_at` (timestamptz) - When the beneficiary was last updated
      - `created_by` (uuid) - User who created the record
      - `updated_by` (uuid) - User who last updated the record

  2. Security
    - Enable RLS on `beneficiaries` table
    - Add policy for authenticated users to view their own beneficiaries
    - Add policy for authenticated users to create their own beneficiaries
    - Add policy for authenticated users to update their own beneficiaries

  3. Constraints
    - Unique constraint on (user_id, bank_account, ifsc) to prevent duplicates
    - Check constraint to ensure status is either 'Active' or 'Inactive'
    - Check constraint to ensure account_type is either 'Saving' or 'Current'
*/

CREATE TABLE IF NOT EXISTS beneficiaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  bank_account text NOT NULL,
  ifsc text NOT NULL,
  bank_name text NOT NULL,
  branch_name text NOT NULL,
  account_type text NOT NULL CHECK (account_type IN ('Saving', 'Current')),
  email text NOT NULL,
  mobile text NOT NULL,
  pan_number text,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active', 'Inactive')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  CONSTRAINT unique_beneficiary_per_user UNIQUE (user_id, bank_account, ifsc)
);

ALTER TABLE beneficiaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own beneficiaries"
  ON beneficiaries FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own beneficiaries"
  ON beneficiaries FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own beneficiaries"
  ON beneficiaries FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_beneficiaries_user_id ON beneficiaries(user_id);
CREATE INDEX IF NOT EXISTS idx_beneficiaries_status ON beneficiaries(status);