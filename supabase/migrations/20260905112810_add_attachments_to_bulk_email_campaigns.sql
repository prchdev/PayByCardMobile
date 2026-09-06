ALTER TABLE bulk_email_campaigns
  ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;
