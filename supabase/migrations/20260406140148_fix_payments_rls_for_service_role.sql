/*
  # Fix RLS Policies for Payments Table

  1. Changes
    - Add RLS policy to allow service role to insert payments
    - Add RLS policy to allow service role to update payments
    - Add RLS policy to allow service role to insert payment logs
  
  2. Security
    - Service role can insert and update payments (needed for edge functions)
    - Existing user policies remain unchanged for frontend access
  
  3. Notes
    - Edge functions use service role key and need explicit RLS policies
    - Without these policies, edge functions cannot write to payments table
*/

-- Drop existing policies if they exist to avoid conflicts
DROP POLICY IF EXISTS "Service role can insert payments" ON payments;
DROP POLICY IF EXISTS "Service role can update payments" ON payments;
DROP POLICY IF EXISTS "Service role can insert payment logs" ON payment_logs;

-- Allow service role to insert payments
CREATE POLICY "Service role can insert payments"
  ON payments
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Allow service role to update payments
CREATE POLICY "Service role can update payments"
  ON payments
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Allow service role to insert payment logs
CREATE POLICY "Service role can insert payment logs"
  ON payment_logs
  FOR INSERT
  TO service_role
  WITH CHECK (true);