/*
# Add DLT Template ID to Bulk SMS Campaigns

## Purpose
Adds a `dlt_template_id` column to the `bulk_sms_campaigns` table so admins can
specify the DLT Content Template ID required by Indian SMS gateways for
transactional/bulk SMS delivery.

## Changes
- ALTER TABLE bulk_sms_campaigns: ADD COLUMN dlt_template_id text DEFAULT ''
*/
ALTER TABLE bulk_sms_campaigns ADD COLUMN IF NOT EXISTS dlt_template_id text DEFAULT '';
