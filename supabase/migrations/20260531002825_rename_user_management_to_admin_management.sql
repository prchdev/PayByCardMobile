/*
  # Rename "User Management" to "Admin Management"

  Changes:
  - Updates the page_name in admin_pages table from "User Management" to "Admin Management"
  - The page_key 'users' and page_path remain unchanged
*/

UPDATE admin_pages
SET page_name = 'Admin Management'
WHERE page_name = 'User Management' AND page_key = 'users';

-- Also update any role_permissions references if they store the name directly
UPDATE role_permissions
SET page_id = page_id  -- no-op, references are by id, no change needed
WHERE page_id = '42ea0c1b-7d7c-4e67-b22c-ce3bfa578f1e';
