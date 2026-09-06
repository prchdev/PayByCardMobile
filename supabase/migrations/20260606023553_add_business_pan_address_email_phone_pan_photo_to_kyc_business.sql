ALTER TABLE kyc_business_info
  ADD COLUMN IF NOT EXISTS business_pan        TEXT,
  ADD COLUMN IF NOT EXISTS business_address    TEXT,
  ADD COLUMN IF NOT EXISTS business_email      TEXT,
  ADD COLUMN IF NOT EXISTS business_phone      TEXT,
  ADD COLUMN IF NOT EXISTS company_pan_photo_url TEXT;