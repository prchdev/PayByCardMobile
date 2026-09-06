/*
# Fix RLS and storage security for mobile notification tables

## 1. mobile_notification_logs — remove unrestricted INSERT policy
The `anon_insert_logs` policy used `WITH CHECK (true)`, allowing any anon/authenticated
user to insert arbitrary rows. All log inserts are done server-side via edge functions
using the service role key (which bypasses RLS), so this anon INSERT policy is unnecessary.
Dropping it closes the unrestricted write path.

## 2. notification-images bucket — remove broad SELECT policy on storage.objects
The bucket is already `public = true`, meaning Supabase serves objects via their public
URLs without any storage policy. The extra `public_read_notification_images` SELECT policy
on `storage.objects` enabled bucket-wide file listing (LIST requests), exposing more than
intended. Public buckets don't need a SELECT policy for URL access, so we drop it.
*/

-- 1. Drop unrestricted INSERT policy on mobile_notification_logs
DROP POLICY IF EXISTS "anon_insert_logs" ON mobile_notification_logs;

-- 2. Drop broad SELECT policy on storage.objects for notification-images bucket
-- (public bucket serves objects via URL without this policy)
DROP POLICY IF EXISTS "public_read_notification_images" ON storage.objects;
