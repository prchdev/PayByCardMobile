-- Revoke public/authenticated execute on SECURITY DEFINER invoice functions
REVOKE EXECUTE ON FUNCTION public.get_next_invoice_number(integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assign_invoice_number() FROM anon, authenticated;

-- RLS policies for invoice_number_sequences: no direct access for any client role
-- The table is only accessed by the SECURITY DEFINER functions running as the table owner
CREATE POLICY "no_select_invoice_sequences" ON public.invoice_number_sequences
  FOR SELECT TO anon, authenticated USING (false);

CREATE POLICY "no_insert_invoice_sequences" ON public.invoice_number_sequences
  FOR INSERT TO anon, authenticated WITH CHECK (false);

CREATE POLICY "no_update_invoice_sequences" ON public.invoice_number_sequences
  FOR UPDATE TO anon, authenticated USING (false);

CREATE POLICY "no_delete_invoice_sequences" ON public.invoice_number_sequences
  FOR DELETE TO anon, authenticated USING (false);
