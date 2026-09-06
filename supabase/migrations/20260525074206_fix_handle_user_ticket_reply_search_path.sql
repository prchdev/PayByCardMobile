/*
  # Fix mutable search_path on handle_user_ticket_reply

  ## Summary
  Sets a fixed search_path on the `handle_user_ticket_reply` trigger function
  to eliminate the "Function Search Path Mutable" security warning. Without a
  fixed search_path, a malicious user could potentially manipulate which schema
  objects the function resolves, leading to privilege escalation.

  ## Changes
  - Recreates `public.handle_user_ticket_reply` with `SET search_path = public, pg_temp`
    appended to the function definition. Logic is unchanged.
*/

CREATE OR REPLACE FUNCTION public.handle_user_ticket_reply()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.is_admin_reply = false THEN
    UPDATE support_tickets
    SET
      last_reply_at = NEW.created_at,
      last_reply_by = NEW.replied_by,
      updated_at    = NEW.created_at,
      updated_by    = NEW.replied_by,
      status = CASE
        WHEN status IN ('On Hold', 'Waiting For More Details') THEN 'Open'
        ELSE status
      END
    WHERE id = NEW.ticket_id;
  ELSE
    UPDATE support_tickets
    SET
      last_reply_at    = NEW.created_at,
      last_reply_by    = NULL,
      admin_replied_at = NEW.created_at,
      admin_replied_by = NEW.admin_replied_by,
      admin_reply_ip   = NEW.created_ip,
      updated_at       = NEW.created_at,
      updated_by       = NULL
    WHERE id = NEW.ticket_id;
  END IF;

  RETURN NEW;
END;
$$;
