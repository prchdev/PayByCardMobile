-- Mark stale processing payouts as completed for payments already in completed status
UPDATE payouts
SET
  status = 'completed',
  completed_at = COALESCE(completed_at, NOW()),
  updated_at = NOW()
WHERE id IN (
  'dff44cb5-e305-4d04-a67e-c612807cfd15',
  '6068d6e3-ff3e-4ec9-b0f5-00317e724eeb',
  '9a327555-f612-41b0-ac7a-ed3d946277a1'
)
AND status = 'processing';
