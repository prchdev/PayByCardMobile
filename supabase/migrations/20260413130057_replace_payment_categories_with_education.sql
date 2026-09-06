/*
  # Replace Payment Categories with Education Categories

  ## Summary
  Replaces all existing payment categories with 28 new education-focused categories.

  ## Changes
  - Disables all existing payment categories (soft delete by setting is_enabled = false)
  - Inserts 28 new education-related payment categories with sequential display_order values

  ## New Categories
  Education fees, tuition, hostel, transport, coaching, library, clubs, and more.

  ## Security
  No RLS changes — existing RLS policies on payment_categories remain intact.
*/

UPDATE payment_categories SET is_enabled = false;

INSERT INTO payment_categories (category_name, is_enabled, display_order) VALUES
  ('College Application Fees', true, 1),
  ('University Tuition Fees', true, 2),
  ('College Fees', true, 3),
  ('School Fees', true, 4),
  ('Tuition Fees', true, 5),
  ('Entrance Test Fees', true, 6),
  ('Exam Registration Fees', true, 7),
  ('Online Course Platform Payments', true, 8),
  ('Pay For Alumni Membership', true, 9),
  ('Hostel Fees', true, 10),
  ('Monthly Hostel Rent', true, 11),
  ('Security Deposit For Mess Accommodation', true, 12),
  ('Coaching Institute Payment', true, 13),
  ('Test Prep Coaching Fees', true, 14),
  ('Pay For Tuition Teacher', true, 15),
  ('eBook Subscriptions', true, 16),
  ('College Shuttle Fees', true, 17),
  ('School Bus Service Fees', true, 18),
  ('Pay For School Shuttle', true, 19),
  ('Pay For School Bus Booking', true, 20),
  ('Computer Lab Fees', true, 21),
  ('Library Membership Fees', true, 22),
  ('Overdue Book Fines', true, 23),
  ('Payment for Stationery and Academic Supplies', true, 24),
  ('School Educational Field Trip Fees', true, 25),
  ('Music Dance Art Class Fees', true, 26),
  ('Kids Sports Club Fees', true, 27),
  ('Science Club Fees', true, 28);
