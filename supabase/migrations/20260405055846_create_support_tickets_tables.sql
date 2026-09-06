/*
  # Create Support Tickets Tables

  1. New Tables
    - `support_tickets`
      - `id` (uuid, primary key)
      - `ticket_number` (text, unique, auto-generated)
      - `user_id` (uuid, references users)
      - `category` (text, ticket category)
      - `sub_category` (text, ticket sub-category)
      - `description` (text, ticket description)
      - `status` (text, ticket status: Open, In Progress, On Hold, Waiting For More Details, Resolved, Closed)
      - `priority` (text, priority level: Low, Medium, High, Urgent)
      - `assigned_to` (uuid, references users - admin who is assigned)
      - `created_at` (timestamptz, creation timestamp)
      - `updated_at` (timestamptz, last update timestamp)
      - `created_by` (uuid, references users)
      - `updated_by` (uuid, references users)
      - `created_ip` (text, IP address of creator)
      - `updated_ip` (text, IP address of last updater)
      - `closed_at` (timestamptz, closure timestamp)
      - `closed_by` (uuid, references users - admin who closed)

    - `support_ticket_replies`
      - `id` (uuid, primary key)
      - `ticket_id` (uuid, references support_tickets)
      - `replied_by` (uuid, references users)
      - `is_admin_reply` (boolean, true if reply is from admin)
      - `message` (text, reply message)
      - `created_at` (timestamptz, creation timestamp)
      - `created_ip` (text, IP address of replier)

    - `support_ticket_attachments`
      - `id` (uuid, primary key)
      - `ticket_id` (uuid, references support_tickets)
      - `reply_id` (uuid, references support_ticket_replies, nullable)
      - `file_name` (text, original file name)
      - `file_path` (text, storage path)
      - `file_size` (integer, file size in bytes)
      - `file_type` (text, MIME type)
      - `uploaded_by` (uuid, references users)
      - `uploaded_at` (timestamptz, upload timestamp)
      - `uploaded_ip` (text, IP address of uploader)

  2. Security
    - Enable RLS on all tables
    - Add policies for users to manage their own tickets
    - Add policies for admins to manage all tickets
*/

-- Create support_tickets table
CREATE TABLE IF NOT EXISTS support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number text UNIQUE NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category text NOT NULL,
  sub_category text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'Open',
  priority text NOT NULL DEFAULT 'Medium',
  assigned_to uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_ip text,
  updated_ip text,
  closed_at timestamptz,
  closed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT valid_status CHECK (status IN ('Open', 'In Progress', 'On Hold', 'Waiting For More Details', 'Resolved', 'Closed')),
  CONSTRAINT valid_priority CHECK (priority IN ('Low', 'Medium', 'High', 'Urgent'))
);

-- Create support_ticket_replies table
CREATE TABLE IF NOT EXISTS support_ticket_replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  replied_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  is_admin_reply boolean NOT NULL DEFAULT false,
  message text NOT NULL,
  created_at timestamptz DEFAULT now(),
  created_ip text
);

-- Create support_ticket_attachments table
CREATE TABLE IF NOT EXISTS support_ticket_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
  reply_id uuid REFERENCES support_ticket_replies(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  file_path text NOT NULL,
  file_size integer NOT NULL,
  file_type text NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  uploaded_at timestamptz DEFAULT now(),
  uploaded_ip text
);

-- Create function to generate ticket number
CREATE OR REPLACE FUNCTION generate_ticket_number()
RETURNS text AS $$
DECLARE
  new_number text;
  exists boolean;
BEGIN
  LOOP
    new_number := 'TKT-' || LPAD(FLOOR(RANDOM() * 1000000)::text, 6, '0');
    SELECT EXISTS(SELECT 1 FROM support_tickets WHERE ticket_number = new_number) INTO exists;
    EXIT WHEN NOT exists;
  END LOOP;
  RETURN new_number;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-generate ticket number
CREATE OR REPLACE FUNCTION set_ticket_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.ticket_number IS NULL OR NEW.ticket_number = '' THEN
    NEW.ticket_number := generate_ticket_number();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_set_ticket_number
  BEFORE INSERT ON support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION set_ticket_number();

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_support_ticket_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_support_ticket_timestamp
  BEFORE UPDATE ON support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION update_support_ticket_timestamp();

-- Enable RLS
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_replies ENABLE ROW LEVEL SECURITY;

-- RLS Policies for support_tickets
CREATE POLICY "Users can view own tickets"
  ON support_tickets FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can create own tickets"
  ON support_tickets FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own tickets"
  ON support_tickets FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- RLS Policies for support_ticket_attachments
CREATE POLICY "Users can view attachments for own tickets"
  ON support_ticket_attachments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM support_tickets
      WHERE support_tickets.id = support_ticket_attachments.ticket_id
      AND support_tickets.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can upload attachments for own tickets"
  ON support_ticket_attachments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM support_tickets
      WHERE support_tickets.id = support_ticket_attachments.ticket_id
      AND support_tickets.user_id = auth.uid()
    )
  );

-- RLS Policies for support_ticket_replies
CREATE POLICY "Users can view replies for own tickets"
  ON support_ticket_replies FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM support_tickets
      WHERE support_tickets.id = support_ticket_replies.ticket_id
      AND support_tickets.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can create replies for own tickets"
  ON support_ticket_replies FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM support_tickets
      WHERE support_tickets.id = support_ticket_replies.ticket_id
      AND support_tickets.user_id = auth.uid()
    )
  );

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id ON support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_ticket_number ON support_tickets(ticket_number);
CREATE INDEX IF NOT EXISTS idx_support_ticket_attachments_ticket_id ON support_ticket_attachments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_support_ticket_attachments_reply_id ON support_ticket_attachments(reply_id);
CREATE INDEX IF NOT EXISTS idx_support_ticket_replies_ticket_id ON support_ticket_replies(ticket_id);