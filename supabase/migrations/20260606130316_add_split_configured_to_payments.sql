DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'payments' AND column_name = 'split_configured'
  ) THEN
    ALTER TABLE payments ADD COLUMN split_configured boolean DEFAULT false;
  END IF;
END $$;
