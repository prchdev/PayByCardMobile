/*
  # Create Storage Bucket for Support Ticket Attachments

  1. Storage
    - Create `support-tickets` bucket for ticket attachments
    - Set file size limit to 1MB
    - Allow PNG, JPG, JPEG, PDF file types

  2. Security
    - Enable RLS on storage bucket
    - Add policies for users to upload/view their own ticket attachments
*/

-- Create storage bucket for support ticket attachments
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'support-tickets',
  'support-tickets',
  false,
  1048576,
  ARRAY['image/png', 'image/jpeg', 'image/jpg', 'application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can upload attachments for own tickets" ON storage.objects;
DROP POLICY IF EXISTS "Users can view attachments for own tickets" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete attachments for own tickets" ON storage.objects;

-- Enable RLS for the bucket
CREATE POLICY "Users can upload attachments for own tickets"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'support-tickets' AND
    (storage.foldername(name))[1] IN (
      SELECT id::text FROM support_tickets WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can view attachments for own tickets"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'support-tickets' AND
    (storage.foldername(name))[1] IN (
      SELECT id::text FROM support_tickets WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete attachments for own tickets"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'support-tickets' AND
    (storage.foldername(name))[1] IN (
      SELECT id::text FROM support_tickets WHERE user_id = auth.uid()
    )
  );