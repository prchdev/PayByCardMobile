/*
  # Move pg_net extension from public schema to extensions schema

  ## Summary
  pg_net was installed in the public schema, which is a security risk as it
  exposes internal extension functions to public access. This migration moves
  it to the dedicated extensions schema.

  ## Changes
  - Drops pg_net from public schema (if present)
  - Recreates pg_net in the extensions schema

  ## Notes
  - The extensions schema is the Supabase-recommended location for extensions
  - All existing cron jobs use net.http_post() which will continue to work
    because the search_path includes the extensions schema
*/

DROP EXTENSION IF EXISTS pg_net;

CREATE EXTENSION IF NOT EXISTS pg_net
  SCHEMA extensions;
