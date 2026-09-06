/*
  # Add missing columns to payment_options

  ## Summary
  The payment_options table (renamed from payment_categories) is missing several
  columns that the admin UI and edge functions expect. This migration adds them
  safely with IF NOT EXISTS guards.

  ## Changes
  - `payment_options`
    - `display_order` (integer, NOT NULL, DEFAULT 0) - controls sort order in UI
    - `new_card_payment_delay_hours` (integer, NOT NULL, DEFAULT 0) - delay before processing new-card payments
    - `settlement_time` (text, NOT NULL, DEFAULT 'instant') - settlement speed
    - `created_by_admin_id` (uuid, nullable) - admin who created the record
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_options' AND column_name = 'display_order'
  ) THEN
    ALTER TABLE payment_options ADD COLUMN display_order integer NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_options' AND column_name = 'new_card_payment_delay_hours'
  ) THEN
    ALTER TABLE payment_options ADD COLUMN new_card_payment_delay_hours integer NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_options' AND column_name = 'settlement_time'
  ) THEN
    ALTER TABLE payment_options ADD COLUMN settlement_time text NOT NULL DEFAULT 'instant';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_options' AND column_name = 'created_by_admin_id'
  ) THEN
    ALTER TABLE payment_options ADD COLUMN created_by_admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;
