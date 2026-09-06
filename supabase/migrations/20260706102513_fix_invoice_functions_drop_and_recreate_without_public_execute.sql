-- Drop and recreate the invoice functions with SECURITY DEFINER but no PUBLIC execute.
-- Trigger functions fire as the function owner (postgres/supabase_admin) via PostgreSQL's
-- internal trigger mechanism and do NOT need EXECUTE granted to any client role.
-- get_next_invoice_number is called only by assign_invoice_number (trigger) and by
-- service-role edge functions — neither path goes through a client role grant.

-- Recreate get_next_invoice_number without the default PUBLIC execute grant
CREATE OR REPLACE FUNCTION public.get_next_invoice_number(p_year integer)
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

-- Recreate assign_invoice_number trigger function without the default PUBLIC execute grant
CREATE OR REPLACE FUNCTION public.assign_invoice_number()
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

-- Revoke from every possible grantee to ensure no client role can call these via RPC
REVOKE ALL ON FUNCTION public.get_next_invoice_number(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assign_invoice_number() FROM PUBLIC, anon, authenticated;
