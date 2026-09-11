-- Delete all data associated with user pravin.chalke2410@gmail.com
-- User ID: 3a1e7c70-9c45-4346-8e50-4a5144d2ba8d
-- Order: child tables first, then parent tables

DELETE FROM transaction_status WHERE user_id = '3a1e7c70-9c45-4346-8e50-4a5144d2ba8d';
DELETE FROM transactions WHERE user_id = '3a1e7c70-9c45-4346-8e50-4a5144d2ba8d';
DELETE FROM payments WHERE user_id = '3a1e7c70-9c45-4346-8e50-4a5144d2ba8d';
DELETE FROM payouts WHERE user_id = '3a1e7c70-9c45-4346-8e50-4a5144d2ba8d';
DELETE FROM beneficiaries WHERE user_id = '3a1e7c70-9c45-4346-8e50-4a5144d2ba8d';
DELETE FROM kyc_address_proof WHERE user_id = '3a1e7c70-9c45-4346-8e50-4a5144d2ba8d';
DELETE FROM kyc_business_info WHERE user_id = '3a1e7c70-9c45-4346-8e50-4a5144d2ba8d';
DELETE FROM kyc_pan_verification WHERE user_id = '3a1e7c70-9c45-4346-8e50-4a5144d2ba8d';
DELETE FROM mobile_notification_logs WHERE user_id = '3a1e7c70-9c45-4346-8e50-4a5144d2ba8d';
DELETE FROM mobile_notifications WHERE user_id = '3a1e7c70-9c45-4346-8e50-4a5144d2ba8d';
DELETE FROM mobile_push_tokens WHERE user_id = '3a1e7c70-9c45-4346-8e50-4a5144d2ba8d';
DELETE FROM otp_verification WHERE user_id = '3a1e7c70-9c45-4346-8e50-4a5144d2ba8d';
DELETE FROM support_tickets WHERE user_id = '3a1e7c70-9c45-4346-8e50-4a5144d2ba8d';
DELETE FROM user_bank_accounts WHERE user_id = '3a1e7c70-9c45-4346-8e50-4a5144d2ba8d';
DELETE FROM user_password_reset_otps WHERE user_id = '3a1e7c70-9c45-4346-8e50-4a5144d2ba8d';
DELETE FROM bulk_campaign_recipients WHERE user_id = '3a1e7c70-9c45-4346-8e50-4a5144d2ba8d';

-- Finally delete the user record
DELETE FROM users WHERE id = '3a1e7c70-9c45-4346-8e50-4a5144d2ba8d';
