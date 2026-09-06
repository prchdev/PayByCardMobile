/*
  # Fix Business KYC Status for Existing Records

  ## Summary
  This migration updates existing business KYC records that have documents uploaded
  but are still marked with 'pending' status to 'verification_pending' status so
  they can be properly reviewed by admins.

  ## Changes
  1. Updates
     - Update `kyc_business_info` records that have either incorporation_certificate_url
       or gst_certificate_url populated but status is 'pending' to 'verification_pending'

  ## Rationale
  - Admin review is only required when business documents are uploaded
  - Records with documents need status 'verification_pending' to show approve/reject buttons
  - This fixes any existing records that were created before the status logic was corrected
*/

UPDATE kyc_business_info
SET status = 'verification_pending', updated_at = now()
WHERE status = 'pending'
  AND (
    incorporation_certificate_url IS NOT NULL 
    OR gst_certificate_url IS NOT NULL
  );