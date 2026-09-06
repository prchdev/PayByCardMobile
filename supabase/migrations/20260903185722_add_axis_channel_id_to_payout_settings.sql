/* Add channel_id to payout_settings for Axis Bank API */
ALTER TABLE payout_settings
  ADD COLUMN IF NOT EXISTS axis_channel_id text NOT NULL DEFAULT 'TXB';
