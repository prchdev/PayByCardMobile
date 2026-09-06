/*
  # Add KYC detail fields to merchant_onboarding

  ## Changes
  - `merchant_onboarding`: adds DigiLocker-fetched identity fields so that
    when a merchant completes KYC via DigiLocker (CashFree or direct), all
    retrieved data is persisted alongside the PAN number.

  ## New columns
  - `full_name`           (text) – name from PAN / Aadhaar via DigiLocker
  - `dob`                 (text) – date of birth
  - `aadhaar_number`      (text) – masked Aadhaar UID (e.g. xxxxxxxx5647)
  - `id_number`           (text) – same as aadhaar_number for address-proof parity
  - `address`             (text) – full address from Aadhaar
  - `city`                (text)
  - `state`               (text)
  - `pincode`             (text)
  - `digilocker_verified` (boolean, default false)
  - `digilocker_provider` (text)  – provider name used for verification
  - `kyc_method`          (text)  – 'digilocker' | 'manual'
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'merchant_onboarding' AND column_name = 'full_name') THEN
    ALTER TABLE public.merchant_onboarding ADD COLUMN full_name text DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'merchant_onboarding' AND column_name = 'dob') THEN
    ALTER TABLE public.merchant_onboarding ADD COLUMN dob text DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'merchant_onboarding' AND column_name = 'aadhaar_number') THEN
    ALTER TABLE public.merchant_onboarding ADD COLUMN aadhaar_number text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'merchant_onboarding' AND column_name = 'id_number') THEN
    ALTER TABLE public.merchant_onboarding ADD COLUMN id_number text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'merchant_onboarding' AND column_name = 'address') THEN
    ALTER TABLE public.merchant_onboarding ADD COLUMN address text DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'merchant_onboarding' AND column_name = 'city') THEN
    ALTER TABLE public.merchant_onboarding ADD COLUMN city text DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'merchant_onboarding' AND column_name = 'state') THEN
    ALTER TABLE public.merchant_onboarding ADD COLUMN state text DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'merchant_onboarding' AND column_name = 'pincode') THEN
    ALTER TABLE public.merchant_onboarding ADD COLUMN pincode text DEFAULT '';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'merchant_onboarding' AND column_name = 'digilocker_verified') THEN
    ALTER TABLE public.merchant_onboarding ADD COLUMN digilocker_verified boolean DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'merchant_onboarding' AND column_name = 'digilocker_provider') THEN
    ALTER TABLE public.merchant_onboarding ADD COLUMN digilocker_provider text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'merchant_onboarding' AND column_name = 'kyc_method') THEN
    ALTER TABLE public.merchant_onboarding ADD COLUMN kyc_method text DEFAULT 'manual';
  END IF;
END $$;
