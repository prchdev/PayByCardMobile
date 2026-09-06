
-- Fix PAY-20260610-744229: the RazorPay payment ID was captured in payment_logs
-- but never written to gateway_transaction_id due to a client-side field mapping bug.
-- Reset the status so the admin can re-initiate the actual RazorPay refund.

UPDATE payments
SET
  gateway_transaction_id = 'pay_SzxdiDmH4hHJ6V',
  gateway_settlement_status = 'pending',
  status = 'settlement_pending',
  updated_at = NOW()
WHERE id = '6aa914ad-900f-4c83-9967-d6343ca22c92'
  AND payment_reference = 'PAY-20260610-744229';

INSERT INTO payment_logs (payment_id, status, message, metadata)
VALUES (
  '6aa914ad-900f-4c83-9967-d6343ca22c92',
  'settlement_pending',
  'DB fix: gateway_transaction_id restored to pay_SzxdiDmH4hHJ6V from payment_logs metadata. Status reset to settlement_pending so admin can re-initiate RazorPay refund. Previous DB-only refund was invalid.',
  '{"fix": "gateway_txn_id_restored", "gateway_transaction_id": "pay_SzxdiDmH4hHJ6V", "razorpay_order_id": "order_SzxckYXFqvyFxN"}'
);
