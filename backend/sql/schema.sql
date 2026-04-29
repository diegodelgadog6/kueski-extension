CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(120) UNIQUE NOT NULL,
  name VARCHAR(120) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS merchants (
  id SERIAL PRIMARY KEY,
  domain VARCHAR(120) UNIQUE NOT NULL,
  name VARCHAR(120) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coupons (
  id SERIAL PRIMARY KEY,
  merchant_id INTEGER NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  code VARCHAR(80) NOT NULL,
  discount VARCHAR(80) NOT NULL,
  expires_at DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_activity (
  id SERIAL PRIMARY KEY,
  merchant_id INTEGER REFERENCES merchants(id) ON DELETE SET NULL,
  action VARCHAR(60) NOT NULL,
  details TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kueski_accounts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_number VARCHAR(40) UNIQUE NOT NULL DEFAULT ('KSK-' || floor(random() * 1000000000)::text),
  credit_limit NUMERIC(12,2) NOT NULL DEFAULT 0,
  available_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  used_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  credit_score INTEGER NOT NULL DEFAULT 650,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_plans (
  id SERIAL PRIMARY KEY,
  name VARCHAR(60) NOT NULL,
  num_installments INTEGER NOT NULL,
  interest_rate NUMERIC(8,4) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES kueski_accounts(id) ON DELETE CASCADE,
  plan_id INTEGER NOT NULL REFERENCES payment_plans(id),
  coupon_id INTEGER REFERENCES coupons(id) ON DELETE SET NULL,
  merchant_id INTEGER REFERENCES merchants(id) ON DELETE SET NULL,
  original_amount NUMERIC(12,2) NOT NULL,
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_amount NUMERIC(12,2) NOT NULL,
  amount_per_installment NUMERIC(12,2) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'authorized',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS installments (
  id SERIAL PRIMARY KEY,
  transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  installment_no INTEGER NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  due_date DATE NOT NULL,
  paid_at TIMESTAMP,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  UNIQUE(transaction_id, installment_no)
);

INSERT INTO merchants (domain, name, active)
VALUES
  ('amazon.com.mx', 'Amazon México', TRUE),
  ('liverpool.com.mx', 'Liverpool', TRUE),
  ('privalia.com.mx', 'Privalia', TRUE),
  ('nike.com', 'Nike', TRUE),
  ('zara.com', 'Zara', TRUE),
  ('att.com.mx', 'AT&T', TRUE),
  ('officedepot.com.mx', 'Office Depot', TRUE),
  ('puma.com', 'Puma', TRUE),
  ('adidas.com.mx', 'Adidas', TRUE),
  ('shein.com', 'Shein', TRUE)
ON CONFLICT (domain) DO NOTHING;

INSERT INTO coupons (merchant_id, code, discount, expires_at, active)
SELECT m.id, seed.code, seed.discount, seed.expires_at, TRUE
FROM (
  VALUES
    ('amazon.com.mx', 'AMAZON15', '15% off', '2026-12-31'::DATE),
    ('liverpool.com.mx', 'LIVERPOOL500', '$500 off', '2026-12-31'::DATE),
    ('privalia.com.mx', 'PRIVALIA10', '10% off', '2026-12-31'::DATE),
    ('nike.com', 'NIKE20', '20% off', '2026-12-31'::DATE),
    ('zara.com', 'ZARA15', '15% off', '2026-12-31'::DATE),
    ('att.com.mx', 'ATT_MSI', 'MSI disponible', NULL),
    ('officedepot.com.mx', 'OFFICE5', '5% cashback', '2026-12-31'::DATE),
    ('puma.com', 'PUMA15', '15% off', '2026-12-31'::DATE),
    ('adidas.com.mx', 'ADIDAS20', '20% off', '2026-12-31'::DATE),
    ('shein.com', 'SHEIN25', '25% off', '2026-12-31'::DATE)
) AS seed(domain, code, discount, expires_at)
JOIN merchants m ON m.domain = seed.domain
WHERE NOT EXISTS (
  SELECT 1 FROM coupons c WHERE c.merchant_id = m.id AND c.code = seed.code
);

INSERT INTO payment_plans (name, num_installments, interest_rate, active)
VALUES
  ('3 quincenas', 3, 0.00, TRUE),
  ('6 quincenas', 6, 0.08, TRUE),
  ('12 quincenas', 12, 0.16, TRUE)
ON CONFLICT DO NOTHING;
