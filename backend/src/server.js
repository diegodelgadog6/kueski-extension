const express = require('express');
const cors = require('cors');
require('dotenv').config();
const db = require('./db');

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(cors());
app.use(express.json());

app.get('/health', async (_req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ ok: true, db: 'connected' });
  } catch (error) {
    res.status(500).json({ ok: false, db: 'error', message: error.message });
  }
});

app.get('/api/merchants/check', async (req, res) => {
  try {
    const domain = String(req.query.domain || '').toLowerCase().trim();

    if (!domain) {
      return res.status(400).json({ affiliated: false, message: 'domain is required' });
    }

    const merchantSql = `
      SELECT id, name, domain
      FROM merchants
      WHERE active = TRUE
      AND $1 LIKE '%' || domain || '%'
      LIMIT 1;
    `;

    const merchantResult = await db.query(merchantSql, [domain]);
    const merchant = merchantResult.rows[0];

    if (!merchant) {
      return res.json({ affiliated: false });
    }

    const couponSql = `
      SELECT code, discount, expires_at
      FROM coupons
      WHERE merchant_id = $1
      AND active = TRUE
      AND (expires_at IS NULL OR expires_at >= CURRENT_DATE)
      ORDER BY expires_at NULLS LAST
      LIMIT 1;
    `;

    const couponResult = await db.query(couponSql, [merchant.id]);
    const coupon = couponResult.rows[0];

    if (!coupon) {
      return res.json({ affiliated: false });
    }

    return res.json({
      affiliated: true,
      merchant: {
        id: merchant.id,
        name: merchant.name,
        domain: merchant.domain,
        coupon: coupon.code,
        discount: coupon.discount,
        expiresAt: coupon.expires_at
      }
    });
  } catch (error) {
    return res.status(500).json({ affiliated: false, message: error.message });
  }
});

app.post('/api/activity', async (req, res) => {
  try {
    const { domain, action, details } = req.body || {};

    if (!domain || !action) {
      return res.status(400).json({ ok: false, message: 'domain and action are required' });
    }

    const merchantResult = await db.query(
      "SELECT id FROM merchants WHERE $1 LIKE '%' || domain || '%' LIMIT 1",
      [String(domain).toLowerCase()]
    );

    const merchantId = merchantResult.rows[0]?.id || null;

    await db.query(
      'INSERT INTO user_activity (merchant_id, action, details) VALUES ($1, $2, $3)',
      [merchantId, action, details || null]
    );

    return res.status(201).json({ ok: true });
  } catch (error) {
    return res.status(500).json({ ok: false, message: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});
