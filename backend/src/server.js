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

//  Get available payment plans 
app.get('/api/planes', async (_req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM payment_plans WHERE active = TRUE ORDER BY num_installments'
    );
    res.json({ ok: true, planes: result.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

//  Validate a coupon code 
app.get('/api/cupones/check', async (req, res) => {
  const { codigo, domain } = req.query;
  if (!codigo) return res.status(400).json({ ok: false, error: 'codigo requerido' });
  try {
    const result = await db.query(`
      SELECT c.*, m.name AS merchant_name
      FROM coupons c
      JOIN merchants m ON m.id = c.merchant_id
      WHERE UPPER(c.code) = UPPER($1)
        AND c.active = TRUE
        AND (c.expires_at IS NULL OR c.expires_at >= CURRENT_DATE)
        AND ($2 = '' OR m.domain = $2)
    `, [codigo, domain || '']);
    if (result.rows.length === 0)
      return res.json({ ok: false, valido: false, mensaje: 'Cupón no válido o expirado' });
    res.json({ ok: true, valido: true, cupon: result.rows[0] });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

//  Get account info for a user 
app.get('/api/cuenta', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ ok: false, error: 'email requerido' });
  try {
    const cuenta = await db.query(`
      SELECT u.name, u.email,
             ka.account_number, ka.credit_limit,
             ka.available_balance, ka.used_balance,
             ka.credit_score, ka.status
      FROM users u
      JOIN kueski_accounts ka ON ka.user_id = u.id
      WHERE u.email = $1
    `, [email]);
    if (cuenta.rows.length === 0)
      return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    const txs = await db.query(`
      SELECT t.id, t.total_amount, t.amount_per_installment,
             pp.num_installments, t.status, t.created_at,
             m.name AS merchant
      FROM transactions t
      JOIN kueski_accounts ka ON ka.id = t.account_id
      JOIN users u            ON u.id  = ka.user_id
      JOIN payment_plans pp   ON pp.id = t.plan_id
      LEFT JOIN merchants m   ON m.id  = t.merchant_id
      WHERE u.email = $1
      ORDER BY t.created_at DESC LIMIT 5
    `, [email]);
    res.json({ ok: true, cuenta: cuenta.rows[0], ultimas_transacciones: txs.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

//  Create a transaction 
app.post('/api/transacciones', async (req, res) => {
  const { email, plan_id, monto, domain, coupon_code } = req.body;
  if (!email || !plan_id || !monto)
    return res.status(400).json({ ok: false, error: 'email, plan_id y monto son requeridos' });

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const cuentaRes = await client.query(`
      SELECT ka.* FROM kueski_accounts ka
      JOIN users u ON u.id = ka.user_id
      WHERE u.email = $1 AND ka.status = 'active'
    `, [email]);
    if (cuentaRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Cuenta no encontrada' });
    }
    const cuenta = cuentaRes.rows[0];
    if (parseFloat(cuenta.available_balance) < parseFloat(monto)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'Saldo insuficiente' });
    }
    const planRes = await client.query(
      'SELECT * FROM payment_plans WHERE id = $1 AND active = TRUE', [plan_id]
    );
    if (planRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Plan no válido' });
    }
    const plan = planRes.rows[0];
    let discount = 0, coupon_id = null;
    if (coupon_code) {
      const couponRes = await client.query(`
        SELECT c.* FROM coupons c JOIN merchants m ON m.id = c.merchant_id
        WHERE UPPER(c.code) = UPPER($1) AND c.active = TRUE
          AND (c.expires_at IS NULL OR c.expires_at >= CURRENT_DATE)
          AND ($2 = '' OR m.domain = $2)
      `, [coupon_code, domain || '']);
      if (couponRes.rows.length > 0) {
        const coupon = couponRes.rows[0];
        coupon_id = coupon.id;
        const pct = coupon.discount.match(/(\d+(\.\d+)?)\s*%/);
        const fixed = coupon.discount.match(/\$\s*(\d+(\.\d+)?)/);
        if (pct)   discount = parseFloat(monto) * (parseFloat(pct[1]) / 100);
        if (fixed) discount = parseFloat(fixed[1]);
        discount = Math.min(discount, parseFloat(monto));
      }
    }
    const base = parseFloat(monto) - discount;
    const total = base * (1 + parseFloat(plan.interest_rate));
    const per_inst = total / plan.num_installments;
    const merchantRes = await client.query(
      'SELECT id FROM merchants WHERE domain = $1', [domain || '']
    );
    const merchant_id = merchantRes.rows[0]?.id || null;
    const txRes = await client.query(`
      INSERT INTO transactions
        (account_id, plan_id, coupon_id, merchant_id,
         original_amount, discount_amount, total_amount, amount_per_installment, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'authorized') RETURNING *
    `, [cuenta.id, plan_id, coupon_id, merchant_id,
        monto, discount.toFixed(2), total.toFixed(2), per_inst.toFixed(2)]);
    const tx = txRes.rows[0];
    for (let i = 1; i <= plan.num_installments; i++) {
      await client.query(`
        INSERT INTO installments (transaction_id, installment_no, amount, due_date)
        VALUES ($1,$2,$3, CURRENT_DATE + ($4 * INTERVAL '15 days'))
      `, [tx.id, i, per_inst.toFixed(2), i]);
    }
    await client.query(`
      UPDATE kueski_accounts
      SET available_balance = available_balance - $1,
          used_balance = used_balance + $1, updated_at = NOW()
      WHERE id = $2
    `, [total.toFixed(2), cuenta.id]);
    await client.query('COMMIT');
    res.status(201).json({
      ok: true,
      transaccion: {
        id: tx.id,
        original_amount: parseFloat(monto).toFixed(2),
        discount_amount: discount.toFixed(2),
        total_amount: total.toFixed(2),
        amount_per_installment: per_inst.toFixed(2),
        num_installments: plan.num_installments,
        status: 'authorized'
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    client.release();
  }
});

app.listen(PORT, () => {
  console.log(`API running on http://localhost:${PORT}`);
});


