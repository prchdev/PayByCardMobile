/*
# Fix card-photos storage bucket policies

## Problem
The initial migration created duplicate, overly broad storage policies alongside the correct folder-scoped ones:
- "Authenticated can upload card photos" allowed ANY authenticated user to upload to ANY path in the card-photos bucket (WITH CHECK only checked bucket_id, not folder ownership) — a privilege escalation.
- "Authenticated can read own card photos" and "Authenticated can delete own card photos" used `owner = auth.uid()`, which doesn't work because uploads go through the service role key (edge functions), so `owner` is the service role, not the user.

## Changes
1. Drop the three broad/incorrect policies:
   - "Authenticated can upload card photos" (INSERT, no folder check)
   - "Authenticated can read own card photos" (SELECT, uses owner field)
   - "Authenticated can delete own card photos" (DELETE, uses owner field)

2. Add a proper DELETE policy scoped to the user's folder (storage.foldername(name)[1] = auth.uid()::text), matching the existing SELECT/INSERT/UPDATE pattern.

3. Keep the existing correct policies:
   - "Users can read own card photos" (SELECT, folder-scoped)
   - "Users can upload own card photos" (INSERT, folder-scoped)
   - "Users can update own card photos" (UPDATE, folder-scoped)
   - "Service role can manage card photos" (ALL, for edge functions)
*/

DROP POLICY IF EXISTS "Authenticated can upload card photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can read own card photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated can delete own card photos" ON storage.objects;

DROP POLICY IF EXISTS "Users can delete own card photos" ON storage.objects;
CREATE POLICY "Users can delete own card photos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'card-photos' AND (storage.foldername(name))[1] = auth.uid()::text);
