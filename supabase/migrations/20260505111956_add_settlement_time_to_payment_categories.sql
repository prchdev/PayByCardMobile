/*
  # Add Settlement Time to Payment Categories

  1. Modified Tables
    - `payment_categories`
      - Added `settlement_time` (text, default 'instant') - Options: instant, same_day, t1, t2

  2. Notes
    - Settlement time determines how quickly payments are settled to receivers
    - Default is 'instant' for backward compatibility with existing categories
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payment_categories' AND column_name = 'settlement_time'
  ) THEN
    ALTER TABLE payment_categories ADD COLUMN settlement_time text DEFAULT 'instant' NOT NULL;
  END IF;
END $$;