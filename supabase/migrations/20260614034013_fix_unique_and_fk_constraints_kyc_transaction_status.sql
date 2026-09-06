-- ── kyc_business_info: enforce one record per user ──────────────────────────
-- The FK to users(id) already exists. Add the missing UNIQUE constraint so
-- a user cannot have duplicate business info rows.
ALTER TABLE kyc_business_info
  ADD CONSTRAINT kyc_business_info_user_id_unique UNIQUE (user_id);

-- ── transaction_status: add FK for user_id → users(id) ───────────────────────
-- user_id is stored as a plain uuid with no FK. Null out any orphaned values first.
UPDATE transaction_status
SET user_id = NULL
WHERE user_id IS NOT NULL
  AND user_id NOT IN (SELECT id FROM users);

-- user_id is NOT NULL so only clean data allowed — wrap in DO block to be safe
DO $$
DECLARE
  orphan_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM transaction_status
  WHERE user_id NOT IN (SELECT id FROM users);

  IF orphan_count > 0 THEN
    RAISE NOTICE 'transaction_status: % rows have orphaned user_id, skipping FK', orphan_count;
  ELSE
    EXECUTE '
      ALTER TABLE transaction_status
        ADD CONSTRAINT transaction_status_user_id_fkey
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
    ';
    RAISE NOTICE 'transaction_status: user_id FK to users(id) added successfully';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transaction_status_user_id
  ON transaction_status(user_id);

-- ── transactions: verify user_id FK points to public.users not auth.users ────
-- The original migration used auth.users. Check and re-point to public.users
-- to be consistent with the rest of the schema.
DO $$
DECLARE
  fk_exists TEXT;
  orphan_count INTEGER;
BEGIN
  -- Check if FK to auth.users exists
  SELECT tc.constraint_name INTO fk_exists
  FROM information_schema.table_constraints tc
  JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
  WHERE tc.table_schema = 'public'
    AND tc.table_name = 'transactions'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND ccu.column_name = 'id'
    AND ccu.table_name = 'users'
    AND ccu.table_schema = 'public'
  LIMIT 1;

  IF fk_exists IS NOT NULL THEN
    RAISE NOTICE 'transactions.user_id already references public.users — no change needed';
  ELSE
    -- Check orphans against public.users
    SELECT COUNT(*) INTO orphan_count
    FROM transactions
    WHERE user_id NOT IN (SELECT id FROM users);

    IF orphan_count > 0 THEN
      RAISE NOTICE 'transactions: % rows have user_id not in public.users — skipping FK change', orphan_count;
    ELSE
      -- Drop old auth.users FK if it exists
      BEGIN
        EXECUTE '
          ALTER TABLE transactions
            DROP CONSTRAINT IF EXISTS fk_transactions_user
        ';
        EXECUTE '
          ALTER TABLE transactions
            ADD CONSTRAINT transactions_user_id_fkey
            FOREIGN KEY (user_id)
            REFERENCES users(id)
            ON DELETE RESTRICT
        ';
        RAISE NOTICE 'transactions: user_id FK updated to reference public.users(id)';
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'transactions: could not update user_id FK — %', SQLERRM;
      END;
    END IF;
  END IF;
END $$;