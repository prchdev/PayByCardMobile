/*
  # Add id_number to kyc_address_proof

  ## Changes
  - `kyc_address_proof`: adds `id_number` (text, nullable) to store the
    document ID number entered by the user (e.g. Aadhaar number, passport
    number, voter ID number, driving licence number).

  This replaces the existing `aadhaar_number` column which only held
  DigiLocker-fetched Aadhaar UIDs. `id_number` is a general field that
  works for all proof_type values. For Aadhaar (manual or DigiLocker) it
  will store the Aadhaar number; for other document types it will store
  the respective document number.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'kyc_address_proof' AND column_name = 'id_number'
  ) THEN
    ALTER TABLE public.kyc_address_proof ADD COLUMN id_number text;
  END IF;
END $$;
