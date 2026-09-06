/*
  # Create KYC Documents Storage Bucket

  Creates a public storage bucket for KYC document uploads (PAN photos, address proof, business certificates).
*/

INSERT INTO storage.buckets (id, name, public)
VALUES ('kyc-documents', 'kyc-documents', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Allow kyc document uploads"
  ON storage.objects FOR INSERT
  TO anon, authenticated
  WITH CHECK (bucket_id = 'kyc-documents');

CREATE POLICY "Allow kyc document reads"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'kyc-documents');

CREATE POLICY "Allow kyc document updates"
  ON storage.objects FOR UPDATE
  TO anon, authenticated
  USING (bucket_id = 'kyc-documents')
  WITH CHECK (bucket_id = 'kyc-documents');
