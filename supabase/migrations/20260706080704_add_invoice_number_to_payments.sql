-- Add invoice_number column to payments
ALTER TABLE payments ADD COLUMN IF NOT EXISTS invoice_number integer;

-- Create table to track per-year invoice number sequences
CREATE TABLE IF NOT EXISTS invoice_number_sequences (
  year integer PRIMARY KEY,
  last_number integer NOT NULL DEFAULT 0
);

ALTER TABLE invoice_number_sequences ENABLE ROW LEVEL SECURITY;

-- Atomically returns and increments the next invoice number for a given year
CREATE OR REPLACE FUNCTION get_next_invoice_number(p_year integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_num integer;
BEGIN
  INSERT INTO invoice_number_sequences (year, last_number)
  VALUES (p_year, 1)
  ON CONFLICT (year) DO UPDATE
    SET last_number = invoice_number_sequences.last_number + 1
  RETURNING last_number INTO next_num;
  RETURN next_num;
END;
$$;

-- Trigger function: assign invoice_number when status transitions to completed or refunded
CREATE OR REPLACE FUNCTION assign_invoice_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('completed', 'refunded')
     AND NEW.invoice_number IS NULL
     AND (OLD.status IS NULL OR OLD.status NOT IN ('completed', 'refunded'))
  THEN
    NEW.invoice_number := get_next_invoice_number(
      EXTRACT(YEAR FROM COALESCE(NEW.completed_at, NOW()))::integer
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_invoice_number ON payments;
CREATE TRIGGER trg_assign_invoice_number
BEFORE UPDATE ON payments
FOR EACH ROW
EXECUTE FUNCTION assign_invoice_number();

-- Backfill existing completed/refunded payments in chronological order
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT id,
           EXTRACT(YEAR FROM COALESCE(completed_at, updated_at, created_at))::integer AS yr
    FROM payments
    WHERE status IN ('completed', 'refunded')
      AND invoice_number IS NULL
    ORDER BY COALESCE(completed_at, updated_at, created_at) ASC
  LOOP
    UPDATE payments
    SET invoice_number = get_next_invoice_number(rec.yr)
    WHERE id = rec.id;
  END LOOP;
END;
$$;
