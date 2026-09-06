/*
  # Add Additional Tracking Fields to Support Tickets

  1. Changes to Tables
    - Add tracking columns to `support_tickets`:
      - `last_reply_at` (timestamptz) - Track when ticket was last replied to
      - `last_reply_by` (uuid) - Track who replied last
      - `admin_replied_at` (timestamptz) - Track when admin last replied
      - `admin_replied_by` (uuid) - Track which admin replied
      - `admin_reply_ip` (text) - Track admin's IP address when replying
    
    - Add IP tracking to `support_ticket_replies`:
      - Already has `created_ip` field
    
  2. Notes
    - These fields help track conversation flow
    - Auto-update status when user replies to On Hold/Waiting For More Details tickets
    - Track all IP addresses and timestamps for audit purposes
*/

-- Add additional tracking columns to support_tickets
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'support_tickets' AND column_name = 'last_reply_at'
  ) THEN
    ALTER TABLE support_tickets ADD COLUMN last_reply_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'support_tickets' AND column_name = 'last_reply_by'
  ) THEN
    ALTER TABLE support_tickets ADD COLUMN last_reply_by uuid REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'support_tickets' AND column_name = 'admin_replied_at'
  ) THEN
    ALTER TABLE support_tickets ADD COLUMN admin_replied_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'support_tickets' AND column_name = 'admin_replied_by'
  ) THEN
    ALTER TABLE support_tickets ADD COLUMN admin_replied_by uuid REFERENCES users(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'support_tickets' AND column_name = 'admin_reply_ip'
  ) THEN
    ALTER TABLE support_tickets ADD COLUMN admin_reply_ip text;
  END IF;
END $$;

-- Create trigger function to update ticket status when user replies
CREATE OR REPLACE FUNCTION handle_user_ticket_reply()
RETURNS TRIGGER AS $$
BEGIN
  -- If reply is from user (not admin)
  IF NEW.is_admin_reply = false THEN
    -- Update the ticket's last_reply_at and last_reply_by
    UPDATE support_tickets
    SET 
      last_reply_at = NEW.created_at,
      last_reply_by = NEW.replied_by,
      updated_at = NEW.created_at,
      updated_by = NEW.replied_by,
      -- Change status to Open if it's On Hold or Waiting For More Details
      status = CASE
        WHEN status IN ('On Hold', 'Waiting For More Details') THEN 'Open'
        ELSE status
      END
    WHERE id = NEW.ticket_id;
  ELSE
    -- If reply is from admin, update admin reply tracking
    UPDATE support_tickets
    SET 
      last_reply_at = NEW.created_at,
      last_reply_by = NEW.replied_by,
      admin_replied_at = NEW.created_at,
      admin_replied_by = NEW.replied_by,
      admin_reply_ip = NEW.created_ip,
      updated_at = NEW.created_at,
      updated_by = NEW.replied_by
    WHERE id = NEW.ticket_id;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Drop trigger if exists and create new one
DROP TRIGGER IF EXISTS trigger_handle_user_ticket_reply ON support_ticket_replies;

CREATE TRIGGER trigger_handle_user_ticket_reply
  AFTER INSERT ON support_ticket_replies
  FOR EACH ROW
  EXECUTE FUNCTION handle_user_ticket_reply();

-- Create indexes for better performance on new columns
CREATE INDEX IF NOT EXISTS idx_support_tickets_last_reply_at ON support_tickets(last_reply_at);
CREATE INDEX IF NOT EXISTS idx_support_tickets_last_reply_by ON support_tickets(last_reply_by);
CREATE INDEX IF NOT EXISTS idx_support_tickets_admin_replied_by ON support_tickets(admin_replied_by);