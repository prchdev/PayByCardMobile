-- F10: "Allow kyc document uploads" let anon and authenticated INSERT any object
--      into the kyc-documents bucket (predicate was the bucket name only).
-- F11: "Allow kyc document updates" let the same roles UPDATE (overwrite) any
--      object in that bucket, including another applicant's PAN/Aadhaar image.
-- All writes to this bucket come from service-role edge functions
-- (upload-kyc-file, digilocker-kyc, merchant-digilocker-kyc), which bypass RLS,
-- so removing the client-role write policies does not affect the app.
DROP POLICY IF EXISTS "Allow kyc document uploads" ON storage.objects;
DROP POLICY IF EXISTS "Allow kyc document updates" ON storage.objects;

-- F13: no server-side size or type limit existed on the KYC bucket, so any file
--      of any type or size could be stored and served.
UPDATE storage.buckets
SET file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/png','image/jpeg','image/jpg','image/webp','application/pdf']
WHERE id = 'kyc-documents';

-- F24: same omission on the notification image bucket, which is public and
--      therefore usable as arbitrary file hosting under the project domain.
UPDATE storage.buckets
SET file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/png','image/jpeg','image/jpg','image/webp','image/gif']
WHERE id = 'notification-images';