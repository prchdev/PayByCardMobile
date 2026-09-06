-- support_tickets.admin_replied_by was added with REFERENCES users(id) but it
-- stores admin_users IDs. Drop that incorrect FK so the trigger can write the
-- admin's UUID without a constraint violation. The column is kept as uuid.
ALTER TABLE support_tickets
  DROP CONSTRAINT IF EXISTS support_tickets_admin_replied_by_fkey;
