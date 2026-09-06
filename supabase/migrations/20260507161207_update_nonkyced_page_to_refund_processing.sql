/*
  # Update Non-KYCed Transactions admin page to use RefundProcessing path

  - Changes the page_path for non-kyced-transactions to /admin/non-kyced-transactions
    which now renders the RefundProcessing component
  - No data loss, just a path clarification
*/

UPDATE admin_pages
SET page_path = '/admin/non-kyced-transactions'
WHERE page_key = 'non-kyced-transactions';
