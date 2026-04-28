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
