-- Remove WAF IP Allowlist from admin menu
DELETE FROM role_permissions WHERE page_id = '16e6a282-4f26-4eeb-bdc0-9bbf9922fd1c';
DELETE FROM admin_pages WHERE id = '16e6a282-4f26-4eeb-bdc0-9bbf9922fd1c';
