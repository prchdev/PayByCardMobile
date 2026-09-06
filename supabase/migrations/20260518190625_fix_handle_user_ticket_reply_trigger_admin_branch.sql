-- Fix handle_user_ticket_reply trigger: admin branch was using NEW.replied_by
-- (which is NULL for admin replies) instead of NEW.admin_replied_by.
-- This caused the insert into support_ticket_replies to fail when an admin
-- replied, because the trigger tried to set admin_replied_by = NULL on the
-- parent support_tickets row, violating business logic and potentially
-- causing constraint errors.

CREATE OR REPLACE FUNCTION handle_user_ticket_reply()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql;
