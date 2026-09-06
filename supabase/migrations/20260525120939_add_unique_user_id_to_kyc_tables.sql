/*
  # Add unique constraints on user_id to KYC tables

  ## Problem
  The DigiLocker auto-approve flow uses upsert with onConflict: 'user_id' on both
  kyc_pan_verification and kyc_address_proof. These tables only had a plain (non-unique)
  index on user_id, so Postgres could not find a matching unique/exclusion constraint
  and threw an error.

  ## Changes
  - kyc_pan_verification: add UNIQUE constraint on user_id
  - kyc_address_proof: add UNIQUE constraint on user_id

  The existing plain indexes are dropped first to avoid duplicate index overhead
  (Postgres automatically creates an index to back the unique constraint).
*/

DO $$
BEGIN
  -- kyc_pan_verification
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.kyc_pan_verification'::regclass
      AND contype = 'u'
      AND conname = 'kyc_pan_verification_user_id_key'
  ) THEN
    ALTER TABLE public.kyc_pan_verification ADD CONSTRAINT kyc_pan_verification_user_id_key UNIQUE (user_id);
  END IF;

  -- kyc_address_proof
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.kyc_address_proof'::regclass
      AND contype = 'u'
      AND conname = 'kyc_address_proof_user_id_key'
  ) THEN
    ALTER TABLE public.kyc_address_proof ADD CONSTRAINT kyc_address_proof_user_id_key UNIQUE (user_id);
  END IF;
END $$;

-- Drop the now-redundant plain indexes (the unique constraint creates its own)
DROP INDEX IF EXISTS public.idx_kyc_pan_user_id;
DROP INDEX IF EXISTS public.idx_kyc_address_user_id;
