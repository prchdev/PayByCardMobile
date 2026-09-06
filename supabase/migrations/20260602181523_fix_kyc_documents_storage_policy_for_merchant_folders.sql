/*
  # Fix kyc-documents storage READ policy to include merchant_ folders

  1. Storage Policy Change
    - Drop the existing authenticated read policy on kyc-documents
    - Recreate it to also allow reads of paths starting with `merchant_` prefix
      (used by merchant DigiLocker KYC XML storage)
    - User-scoped paths (auth.uid() folder) remain allowed as before

  2. Notes
    - Admin users access merchant XML files via the public URL stored in
      merchant_onboarding.aadhaar_front_url / aadhaar_back_url / pan_photo_url
    - Without this policy, those public URLs would 403 at the storage layer
*/

DROP POLICY IF EXISTS "Authenticated users can read own kyc docs" ON storage.objects;

CREATE POLICY "Authenticated users can read own kyc docs"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'kyc-documents'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR (storage.foldername(name))[1] = 'master-settings'
      OR (storage.foldername(name))[1] LIKE 'merchant_%'
    )
  );
