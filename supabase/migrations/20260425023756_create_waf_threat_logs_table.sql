/*
  # Create WAF threat logs table

  1. New Tables
    - `waf_threat_logs`
      - `id` (uuid, primary key)
      - `ip_address` (text) - IP address of the blocked request
      - `threat_type` (text) - Type of threat detected (sql_injection, xss, etc.)
      - `request_url` (text) - The URL that was requested
      - `request_method` (text) - HTTP method (GET, POST, etc.)
      - `blocked` (boolean, default true) - Whether the request was blocked
      - `created_at` (timestamptz) - When the threat was detected

  2. Security
    - Enable RLS on `waf_threat_logs` table
    - No public access policies - only service role can insert/read
*/

CREATE TABLE IF NOT EXISTS waf_threat_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_address text NOT NULL DEFAULT '',
  threat_type text NOT NULL DEFAULT '',
  request_url text NOT NULL DEFAULT '',
  request_method text NOT NULL DEFAULT '',
  blocked boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE waf_threat_logs ENABLE ROW LEVEL SECURITY;
