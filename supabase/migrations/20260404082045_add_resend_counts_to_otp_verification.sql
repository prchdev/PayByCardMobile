/*
  # Add Resend Count Tracking to OTP Verification

  1. Changes
    - Add `mobile_resend_count` column to track mobile OTP resend attempts
    - Add `email_resend_count` column to track email OTP resend attempts
    - Set default value to 0 for both columns
    - Update existing records to have resend count of 0

  2. Purpose
    - Limit resend functionality to 2 attempts per OTP type
    - Prevent abuse of OTP resend feature
    - Track resend attempts for audit purposes
*/

-- Add resend count columns
ALTER TABLE otp_verification 
  ADD COLUMN IF NOT EXISTS mobile_resend_count integer DEFAULT 0 NOT NULL,
  ADD COLUMN IF NOT EXISTS email_resend_count integer DEFAULT 0 NOT NULL;

-- Update existing records to have resend count of 0
UPDATE otp_verification 
SET mobile_resend_count = 0, email_resend_count = 0
WHERE mobile_resend_count IS NULL OR email_resend_count IS NULL;
