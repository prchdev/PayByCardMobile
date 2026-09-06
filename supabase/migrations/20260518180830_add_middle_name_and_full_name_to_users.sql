/*
  # Add middle_name and full_name columns to users table

  1. Changes
    - `users.middle_name` (text, nullable) — stores the optional middle name provided at registration
    - `users.full_name` (text, nullable) — derived concatenation of first + middle (if present) + last name,
      stored for fast lookup and display without re-computing each time
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'middle_name'
  ) THEN
    ALTER TABLE users ADD COLUMN middle_name text DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'full_name'
  ) THEN
    ALTER TABLE users ADD COLUMN full_name text DEFAULT NULL;
  END IF;
END $$;

-- Back-fill full_name for existing rows that don't have it set yet
UPDATE users
SET full_name = trim(first_name || ' ' || last_name)
WHERE full_name IS NULL;
