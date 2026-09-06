UPDATE payments
SET
  status = 'settlement_pending',
  gateway_settlement_status = 'paid'
WHERE payment_reference = 'PAY-20260613-946718';
