CREATE TABLE phonepe_payment_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_gateway_id uuid NOT NULL REFERENCES payment_gateway_settings(id) ON DELETE CASCADE,
  payment_option_id uuid NOT NULL REFERENCES payment_options(id) ON DELETE CASCADE,
  card_types text[] NOT NULL DEFAULT '{}',
  networks text[] NOT NULL DEFAULT '{}',
  variants text[] NOT NULL DEFAULT '{}',
  geo_scopes text[] NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_gateway_id, payment_option_id)
);

ALTER TABLE phonepe_payment_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_phonepe_configs_admin"
  ON phonepe_payment_configs FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "insert_phonepe_configs_admin"
  ON phonepe_payment_configs FOR INSERT
  TO authenticated WITH CHECK (true);

CREATE POLICY "update_phonepe_configs_admin"
  ON phonepe_payment_configs FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "delete_phonepe_configs_admin"
  ON phonepe_payment_configs FOR DELETE
  TO authenticated USING (true);
