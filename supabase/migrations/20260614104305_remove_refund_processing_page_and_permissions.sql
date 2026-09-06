
-- Remove role_permissions entries for the refund-processing page
DELETE FROM role_permissions
WHERE page_id = 'c987d1ba-1f75-4a69-8aae-74710930856a';

-- Remove the admin_pages entry
DELETE FROM admin_pages
WHERE id = 'c987d1ba-1f75-4a69-8aae-74710930856a';
