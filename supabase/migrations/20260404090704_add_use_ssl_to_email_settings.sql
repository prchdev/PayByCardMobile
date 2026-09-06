/*
  # Add use_ssl field to email_settings table

  1. Changes
    - Add `use_ssl` boolean column to `email_settings` table
    - Default to false (STARTTLS mode)
    - This allows separate control of TLS and SSL settings
  
  2. Notes
    - use_tls = true with use_ssl = false means STARTTLS (port 587)
    - use_tls = true with use_ssl = true means direct SSL/TLS (port 465)
    - use_tls = false with use_ssl = false means no encryption (not recommended)
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'email_settings' AND column_name = 'use_ssl'
  ) THEN
    ALTER TABLE email_settings ADD COLUMN use_ssl boolean DEFAULT false;
  END IF;
END $$;
