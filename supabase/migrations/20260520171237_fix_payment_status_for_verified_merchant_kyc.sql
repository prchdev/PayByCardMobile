/*
  # Fix payment status for payments with verified merchant KYC

  Payments PAY-20260520-722198 and PAY-20260520-537495 have status 'kyc_pending'
  despite their associated merchant_onboarding records being 'verified'.
  This migration corrects the payment status to 'settlement_pending'.

  Only updates payments where:
  - Current status is 'kyc_pending'
  - There is a linked merchant_onboarding record with status 'verified'
*/

UPDATE payments p
SET 
  status = 'settlement_pending',
  updated_at = now()
FROM merchant_onboarding mo
WHERE mo.payment_id = p.id
  AND mo.status = 'verified'
  AND p.status = 'kyc_pending';
