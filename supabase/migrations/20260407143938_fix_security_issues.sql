/*
  # Fix Security Issues

  ## Changes Made

  ### 1. Add Missing Foreign Key Indexes
  - Added indexes for all unindexed foreign keys across multiple tables
  - Improves query performance for foreign key lookups and joins

  ### 2. Optimize RLS Policies
  - Updated all RLS policies to use `(select auth.uid())` instead of `auth.uid()`
  - Prevents re-evaluation of auth functions for each row
  - Significantly improves query performance at scale

  ### 3. Fix Function Search Paths
  - Set search_path to empty string for all trigger functions
  - Prevents security vulnerabilities from search path manipulation

  ### 4. Fix Overly Permissive RLS Policies
  - Restricted policies that allow unrestricted access
  - Added proper authentication checks

  ### 5. Remove Duplicate Policies
  - Consolidated duplicate permissive policies
  - Ensures consistent access control
*/

-- ============================================================================
-- PART 1: Add Missing Foreign Key Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_admin_users_created_by ON public.admin_users(created_by);
CREATE INDEX IF NOT EXISTS idx_admin_users_updated_by ON public.admin_users(updated_by);
CREATE INDEX IF NOT EXISTS idx_beneficiaries_created_by ON public.beneficiaries(created_by);
CREATE INDEX IF NOT EXISTS idx_beneficiaries_updated_by ON public.beneficiaries(updated_by);
CREATE INDEX IF NOT EXISTS idx_payment_gateway_settings_created_by ON public.payment_gateway_settings(created_by);
CREATE INDEX IF NOT EXISTS idx_payment_gateway_settings_updated_by ON public.payment_gateway_settings(updated_by);
CREATE INDEX IF NOT EXISTS idx_payment_limits_created_by ON public.payment_limits(created_by);
CREATE INDEX IF NOT EXISTS idx_payment_limits_updated_by ON public.payment_limits(updated_by);
CREATE INDEX IF NOT EXISTS idx_payment_options_updated_by ON public.payment_options(updated_by_admin_id);
CREATE INDEX IF NOT EXISTS idx_payments_beneficiary_id ON public.payments(beneficiary_id);
CREATE INDEX IF NOT EXISTS idx_payments_payment_gateway_id ON public.payments(payment_gateway_id);
CREATE INDEX IF NOT EXISTS idx_payments_payment_category_id ON public.payments(payment_category_id);
CREATE INDEX IF NOT EXISTS idx_payouts_beneficiary_id ON public.payouts(beneficiary_id);
CREATE INDEX IF NOT EXISTS idx_payouts_payment_gateway_id ON public.payouts(payment_gateway_id);
CREATE INDEX IF NOT EXISTS idx_sms_provider_settings_created_by ON public.sms_provider_settings(created_by);
CREATE INDEX IF NOT EXISTS idx_sms_provider_settings_updated_by ON public.sms_provider_settings(updated_by);
CREATE INDEX IF NOT EXISTS idx_sms_settings_created_by ON public.sms_settings(created_by);
CREATE INDEX IF NOT EXISTS idx_sms_settings_updated_by ON public.sms_settings(updated_by);
CREATE INDEX IF NOT EXISTS idx_support_ticket_attachments_admin_uploaded_by ON public.support_ticket_attachments(admin_uploaded_by);
CREATE INDEX IF NOT EXISTS idx_support_ticket_attachments_uploaded_by ON public.support_ticket_attachments(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_support_ticket_replies_admin_replied_by ON public.support_ticket_replies(admin_replied_by);
CREATE INDEX IF NOT EXISTS idx_support_ticket_replies_replied_by ON public.support_ticket_replies(replied_by);
CREATE INDEX IF NOT EXISTS idx_support_tickets_assigned_to ON public.support_tickets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created_by ON public.support_tickets(created_by);
CREATE INDEX IF NOT EXISTS idx_support_tickets_updated_by ON public.support_tickets(updated_by);
CREATE INDEX IF NOT EXISTS idx_transactions_payment_category ON public.transactions(payment_category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_payment_option ON public.transactions(payment_option_id);
CREATE INDEX IF NOT EXISTS idx_transactions_payout ON public.transactions(payout_id);

-- ============================================================================
-- PART 2: Optimize RLS Policies
-- ============================================================================

-- Users table
DROP POLICY IF EXISTS "Users can read own data" ON public.users;
DROP POLICY IF EXISTS "Users can update own data" ON public.users;
DROP POLICY IF EXISTS "Allow user registration" ON public.users;

CREATE POLICY "Users can read own data" ON public.users FOR SELECT TO authenticated USING (id = (select auth.uid()));
CREATE POLICY "Users can update own data" ON public.users FOR UPDATE TO authenticated USING (id = (select auth.uid())) WITH CHECK (id = (select auth.uid()));
CREATE POLICY "Allow user registration" ON public.users FOR INSERT TO anon, authenticated WITH CHECK (id = (select auth.uid()));

-- OTP Verification
DROP POLICY IF EXISTS "Users can read own OTP records" ON public.otp_verification;
DROP POLICY IF EXISTS "Users can update own OTP records" ON public.otp_verification;
DROP POLICY IF EXISTS "Allow OTP creation during registration" ON public.otp_verification;

CREATE POLICY "Users can read own OTP records" ON public.otp_verification FOR SELECT TO authenticated USING (user_id = (select auth.uid()));
CREATE POLICY "Users can update own OTP records" ON public.otp_verification FOR UPDATE TO authenticated USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));
CREATE POLICY "Allow OTP creation during registration" ON public.otp_verification FOR INSERT TO anon, authenticated WITH CHECK (user_id = (select auth.uid()));

-- KYC tables
DROP POLICY IF EXISTS "Users can select own pan verification" ON public.kyc_pan_verification;
DROP POLICY IF EXISTS "Users can insert own pan verification" ON public.kyc_pan_verification;
DROP POLICY IF EXISTS "Users can update own pan verification" ON public.kyc_pan_verification;

CREATE POLICY "Users can select own pan verification" ON public.kyc_pan_verification FOR SELECT TO authenticated USING (user_id = (select auth.uid()));
CREATE POLICY "Users can insert own pan verification" ON public.kyc_pan_verification FOR INSERT TO authenticated WITH CHECK (user_id = (select auth.uid()));
CREATE POLICY "Users can update own pan verification" ON public.kyc_pan_verification FOR UPDATE TO authenticated USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can select own address proof" ON public.kyc_address_proof;
DROP POLICY IF EXISTS "Users can insert own address proof" ON public.kyc_address_proof;
DROP POLICY IF EXISTS "Users can update own address proof" ON public.kyc_address_proof;

CREATE POLICY "Users can select own address proof" ON public.kyc_address_proof FOR SELECT TO authenticated USING (user_id = (select auth.uid()));
CREATE POLICY "Users can insert own address proof" ON public.kyc_address_proof FOR INSERT TO authenticated WITH CHECK (user_id = (select auth.uid()));
CREATE POLICY "Users can update own address proof" ON public.kyc_address_proof FOR UPDATE TO authenticated USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));

DROP POLICY IF EXISTS "Users can select own business info" ON public.kyc_business_info;
DROP POLICY IF EXISTS "Users can insert own business info" ON public.kyc_business_info;
DROP POLICY IF EXISTS "Users can update own business info" ON public.kyc_business_info;

CREATE POLICY "Users can select own business info" ON public.kyc_business_info FOR SELECT TO authenticated USING (user_id = (select auth.uid()));
CREATE POLICY "Users can insert own business info" ON public.kyc_business_info FOR INSERT TO authenticated WITH CHECK (user_id = (select auth.uid()));
CREATE POLICY "Users can update own business info" ON public.kyc_business_info FOR UPDATE TO authenticated USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));

-- Admin Users - Consolidate duplicate policies
DROP POLICY IF EXISTS "Admins can read own data" ON public.admin_users;
DROP POLICY IF EXISTS "Admins can view all admin users" ON public.admin_users;
DROP POLICY IF EXISTS "Super admins can insert new admin users" ON public.admin_users;
DROP POLICY IF EXISTS "Super admins can update admin users" ON public.admin_users;
DROP POLICY IF EXISTS "Admins can update own profile" ON public.admin_users;

CREATE POLICY "Admins can view all admin users" ON public.admin_users FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.id = (select auth.uid()) AND au.is_active = true));
CREATE POLICY "Super admins can insert new admin users" ON public.admin_users FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.id = (select auth.uid()) AND au.role = 'super_admin' AND au.is_active = true));
CREATE POLICY "Super admins and self can update admin users" ON public.admin_users FOR UPDATE TO authenticated USING (id = (select auth.uid()) OR EXISTS (SELECT 1 FROM public.admin_users au WHERE au.id = (select auth.uid()) AND au.role = 'super_admin' AND au.is_active = true)) WITH CHECK (id = (select auth.uid()) OR EXISTS (SELECT 1 FROM public.admin_users au WHERE au.id = (select auth.uid()) AND au.role = 'super_admin' AND au.is_active = true));

-- Beneficiaries
DROP POLICY IF EXISTS "Users can view own beneficiaries" ON public.beneficiaries;
DROP POLICY IF EXISTS "Users can create own beneficiaries" ON public.beneficiaries;
DROP POLICY IF EXISTS "Users can update own beneficiaries" ON public.beneficiaries;

CREATE POLICY "Users can view own beneficiaries" ON public.beneficiaries FOR SELECT TO authenticated USING (user_id = (select auth.uid()));
CREATE POLICY "Users can create own beneficiaries" ON public.beneficiaries FOR INSERT TO authenticated WITH CHECK (user_id = (select auth.uid()));
CREATE POLICY "Users can update own beneficiaries" ON public.beneficiaries FOR UPDATE TO authenticated USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));

-- Payment Gateway Settings
DROP POLICY IF EXISTS "Admins can view gateway settings" ON public.payment_gateway_settings;
DROP POLICY IF EXISTS "Admins can insert gateway settings" ON public.payment_gateway_settings;
DROP POLICY IF EXISTS "Admins can update gateway settings" ON public.payment_gateway_settings;
DROP POLICY IF EXISTS "Admins can delete gateway settings" ON public.payment_gateway_settings;

CREATE POLICY "Admins can view gateway settings" ON public.payment_gateway_settings FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.id = (select auth.uid()) AND au.is_active = true));
CREATE POLICY "Admins can insert gateway settings" ON public.payment_gateway_settings FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.id = (select auth.uid()) AND au.is_active = true));
CREATE POLICY "Admins can update gateway settings" ON public.payment_gateway_settings FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.id = (select auth.uid()) AND au.is_active = true)) WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.id = (select auth.uid()) AND au.is_active = true));
CREATE POLICY "Admins can delete gateway settings" ON public.payment_gateway_settings FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.id = (select auth.uid()) AND au.is_active = true));

-- SMS Settings
DROP POLICY IF EXISTS "Admin users can view sms settings" ON public.sms_settings;
DROP POLICY IF EXISTS "Admin users can update sms settings" ON public.sms_settings;

CREATE POLICY "Admin users can view sms settings" ON public.sms_settings FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.id = (select auth.uid()) AND au.is_active = true));
CREATE POLICY "Admin users can update sms settings" ON public.sms_settings FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.id = (select auth.uid()) AND au.is_active = true)) WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.id = (select auth.uid()) AND au.is_active = true));

-- SMS Provider Settings
DROP POLICY IF EXISTS "Admin users can view sms provider settings" ON public.sms_provider_settings;
DROP POLICY IF EXISTS "Admin users can update sms provider settings" ON public.sms_provider_settings;

CREATE POLICY "Admin users can view sms provider settings" ON public.sms_provider_settings FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.id = (select auth.uid()) AND au.is_active = true));
CREATE POLICY "Admin users can update sms provider settings" ON public.sms_provider_settings FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.id = (select auth.uid()) AND au.is_active = true)) WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.id = (select auth.uid()) AND au.is_active = true));

-- Admin Pages
DROP POLICY IF EXISTS "Authenticated admins can view admin pages" ON public.admin_pages;
DROP POLICY IF EXISTS "Super admins can insert admin pages" ON public.admin_pages;
DROP POLICY IF EXISTS "Super admins can update admin pages" ON public.admin_pages;

CREATE POLICY "Authenticated admins can view admin pages" ON public.admin_pages FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.id = (select auth.uid()) AND au.is_active = true));
CREATE POLICY "Super admins can insert admin pages" ON public.admin_pages FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.id = (select auth.uid()) AND au.role = 'super_admin' AND au.is_active = true));
CREATE POLICY "Super admins can update admin pages" ON public.admin_pages FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.id = (select auth.uid()) AND au.role = 'super_admin' AND au.is_active = true)) WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.id = (select auth.uid()) AND au.role = 'super_admin' AND au.is_active = true));

-- Role Permissions
DROP POLICY IF EXISTS "Authenticated admins can view role permissions" ON public.role_permissions;
DROP POLICY IF EXISTS "Super admins can insert role permissions" ON public.role_permissions;
DROP POLICY IF EXISTS "Super admins can update role permissions" ON public.role_permissions;
DROP POLICY IF EXISTS "Super admins can delete role permissions" ON public.role_permissions;

CREATE POLICY "Authenticated admins can view role permissions" ON public.role_permissions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.id = (select auth.uid()) AND au.is_active = true));
CREATE POLICY "Super admins can insert role permissions" ON public.role_permissions FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.id = (select auth.uid()) AND au.role = 'super_admin' AND au.is_active = true));
CREATE POLICY "Super admins can update role permissions" ON public.role_permissions FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.id = (select auth.uid()) AND au.role = 'super_admin' AND au.is_active = true)) WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.id = (select auth.uid()) AND au.role = 'super_admin' AND au.is_active = true));
CREATE POLICY "Super admins can delete role permissions" ON public.role_permissions FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.id = (select auth.uid()) AND au.role = 'super_admin' AND au.is_active = true));

-- Payment Limits
DROP POLICY IF EXISTS "Authenticated users can insert payment limits" ON public.payment_limits;
DROP POLICY IF EXISTS "Authenticated users can update payment limits" ON public.payment_limits;

CREATE POLICY "Admins can insert payment limits" ON public.payment_limits FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.id = (select auth.uid()) AND au.is_active = true));
CREATE POLICY "Admins can update payment limits" ON public.payment_limits FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.id = (select auth.uid()) AND au.is_active = true)) WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users au WHERE au.id = (select auth.uid()) AND au.is_active = true));

-- Payments
DROP POLICY IF EXISTS "Users can view own payments" ON public.payments;
DROP POLICY IF EXISTS "Users can insert own payments" ON public.payments;
DROP POLICY IF EXISTS "Users can update own payments" ON public.payments;

CREATE POLICY "Users can view own payments" ON public.payments FOR SELECT TO authenticated USING (user_id = (select auth.uid()));
CREATE POLICY "Users can insert own payments" ON public.payments FOR INSERT TO authenticated WITH CHECK (user_id = (select auth.uid()));
CREATE POLICY "Users can update own payments" ON public.payments FOR UPDATE TO authenticated USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));

-- Payment Logs - Remove duplicates
DROP POLICY IF EXISTS "Users can view own payment logs" ON public.payment_logs;
DROP POLICY IF EXISTS "Users can view their own payment logs" ON public.payment_logs;
DROP POLICY IF EXISTS "Authenticated users can insert payment logs" ON public.payment_logs;

CREATE POLICY "Users can view own payment logs" ON public.payment_logs FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.payments p WHERE p.id = payment_logs.payment_id AND p.user_id = (select auth.uid())));

-- Support Tickets
DROP POLICY IF EXISTS "Users can view own tickets" ON public.support_tickets;
DROP POLICY IF EXISTS "Users can create own tickets" ON public.support_tickets;
DROP POLICY IF EXISTS "Users can update own tickets" ON public.support_tickets;

CREATE POLICY "Users can view own tickets" ON public.support_tickets FOR SELECT TO authenticated USING (created_by = (select auth.uid()));
CREATE POLICY "Users can create own tickets" ON public.support_tickets FOR INSERT TO authenticated WITH CHECK (created_by = (select auth.uid()));
CREATE POLICY "Users can update own tickets" ON public.support_tickets FOR UPDATE TO authenticated USING (created_by = (select auth.uid())) WITH CHECK (created_by = (select auth.uid()));

-- Support Ticket Attachments
DROP POLICY IF EXISTS "Users can view attachments for own tickets" ON public.support_ticket_attachments;
DROP POLICY IF EXISTS "Users can upload attachments for own tickets" ON public.support_ticket_attachments;

CREATE POLICY "Users can view attachments for own tickets" ON public.support_ticket_attachments FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.support_tickets st WHERE st.id = support_ticket_attachments.ticket_id AND st.created_by = (select auth.uid())));
CREATE POLICY "Users can upload attachments for own tickets" ON public.support_ticket_attachments FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.support_tickets st WHERE st.id = support_ticket_attachments.ticket_id AND st.created_by = (select auth.uid())));

-- Support Ticket Replies
DROP POLICY IF EXISTS "Users can view replies for own tickets" ON public.support_ticket_replies;
DROP POLICY IF EXISTS "Users can create replies for own tickets" ON public.support_ticket_replies;

CREATE POLICY "Users can view replies for own tickets" ON public.support_ticket_replies FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.support_tickets st WHERE st.id = support_ticket_replies.ticket_id AND st.created_by = (select auth.uid())));
CREATE POLICY "Users can create replies for own tickets" ON public.support_ticket_replies FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.support_tickets st WHERE st.id = support_ticket_replies.ticket_id AND st.created_by = (select auth.uid())));

-- Payouts
DROP POLICY IF EXISTS "Users can view own payouts" ON public.payouts;
DROP POLICY IF EXISTS "Users can insert own payouts" ON public.payouts;
DROP POLICY IF EXISTS "Users can update own payouts" ON public.payouts;

CREATE POLICY "Users can view own payouts" ON public.payouts FOR SELECT TO authenticated USING (user_id = (select auth.uid()));
CREATE POLICY "Users can insert own payouts" ON public.payouts FOR INSERT TO authenticated WITH CHECK (user_id = (select auth.uid()));
CREATE POLICY "Users can update own payouts" ON public.payouts FOR UPDATE TO authenticated USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));

-- Payout Logs
DROP POLICY IF EXISTS "Users can view own payout logs" ON public.payout_logs;
DROP POLICY IF EXISTS "Authenticated users can insert payout logs" ON public.payout_logs;

CREATE POLICY "Users can view own payout logs" ON public.payout_logs FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.payouts p WHERE p.id = payout_logs.payout_id AND p.user_id = (select auth.uid())));

-- Transactions
DROP POLICY IF EXISTS "Users can view own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can create own transactions" ON public.transactions;
DROP POLICY IF EXISTS "Users can update own transactions" ON public.transactions;

CREATE POLICY "Users can view own transactions" ON public.transactions FOR SELECT TO authenticated USING (user_id = (select auth.uid()));
CREATE POLICY "Users can create own transactions" ON public.transactions FOR INSERT TO authenticated WITH CHECK (user_id = (select auth.uid()));
CREATE POLICY "Users can update own transactions" ON public.transactions FOR UPDATE TO authenticated USING (user_id = (select auth.uid())) WITH CHECK (user_id = (select auth.uid()));

-- Transaction Logs
DROP POLICY IF EXISTS "Users can view own transaction logs" ON public.transaction_logs;
DROP POLICY IF EXISTS "System can insert transaction logs" ON public.transaction_logs;

CREATE POLICY "Users can view own transaction logs" ON public.transaction_logs FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.transactions t WHERE t.id = transaction_logs.transaction_id AND t.user_id = (select auth.uid())));

-- Transaction Status
DROP POLICY IF EXISTS "Users can read own transaction status" ON public.transaction_status;

CREATE POLICY "Users can read own transaction status" ON public.transaction_status FOR SELECT TO authenticated USING (user_id = (select auth.uid()));

-- ============================================================================
-- PART 3: Fix Function Search Paths
-- ============================================================================

ALTER FUNCTION public.update_payouts_updated_at() SET search_path = '';
ALTER FUNCTION public.generate_payout_reference() SET search_path = '';
ALTER FUNCTION public.update_transactions_updated_at() SET search_path = '';
ALTER FUNCTION public.update_transaction_status_updated_at() SET search_path = '';
ALTER FUNCTION public.set_ticket_number() SET search_path = '';
ALTER FUNCTION public.update_support_ticket_timestamp() SET search_path = '';
ALTER FUNCTION public.handle_user_ticket_reply() SET search_path = '';
ALTER FUNCTION public.update_payment_limits_updated_at() SET search_path = '';
ALTER FUNCTION public.update_updated_at_column() SET search_path = '';
ALTER FUNCTION public.update_kyc_updated_at() SET search_path = '';
ALTER FUNCTION public.update_admin_updated_at() SET search_path = '';
ALTER FUNCTION public.update_email_settings_updated_at() SET search_path = '';
ALTER FUNCTION public.update_admin_users_updated_at() SET search_path = '';
ALTER FUNCTION public.update_payments_updated_at() SET search_path = '';
ALTER FUNCTION public.generate_payment_reference() SET search_path = '';
ALTER FUNCTION public.generate_ticket_number() SET search_path = '';
