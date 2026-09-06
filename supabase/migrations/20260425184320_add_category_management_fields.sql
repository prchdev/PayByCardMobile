/*
  # Add category management fields to payment_categories

  1. Modified Tables
    - `payment_categories`
      - `receiver_kyc_required` (boolean, default false) - Whether the receiver must have completed KYC
      - `new_card_payment_delay_hours` (integer, default 0) - Delay in hours before new card payments are processed
      - `created_by_admin_id` (uuid, nullable) - Admin who created the category
      - `updated_by_admin_id` (uuid, nullable) - Admin who last updated the category

  2. Important Notes
    - Existing rows get default values (receiver_kyc_required=false, delay=0)
    - No data is dropped or deleted
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_categories' AND column_name = 'receiver_kyc_required'
  ) THEN
    ALTER TABLE payment_categories ADD COLUMN receiver_kyc_required boolean NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_categories' AND column_name = 'new_card_payment_delay_hours'
  ) THEN
    ALTER TABLE payment_categories ADD COLUMN new_card_payment_delay_hours integer NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_categories' AND column_name = 'created_by_admin_id'
  ) THEN
    ALTER TABLE payment_categories ADD COLUMN created_by_admin_id uuid;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_categories' AND column_name = 'updated_by_admin_id'
  ) THEN
    ALTER TABLE payment_categories ADD COLUMN updated_by_admin_id uuid;
  END IF;
END $$;
