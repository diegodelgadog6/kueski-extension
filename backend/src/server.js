const express = require('express');
const cors = require('cors');
require('dotenv').config();
const db = require('./db');

const DEMO_CREDIT_LIMIT = 45000;

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

// Demo loan/top-up endpoint for prototype presentation
app.post('/api/prestamo-demo', async (req, res) => {
  const { email, amount } = req.body || {};

  if (!email || !amount) {
    return res.status(400).json({ ok: false, error: 'email y amount son requeridos' });
  }

  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ ok: false, error: 'amount debe ser un número válido mayor a 0' });
  }

  let client;
  try {
    client = await db.pool.connect();
    await client.query('BEGIN');

    const accountResult = await client.query(`
      SELECT ka.id, ka.available_balance, u.name
      FROM kueski_accounts ka
      JOIN users u ON u.id = ka.user_id
      WHERE u.email = $1 AND ka.status = 'active'
      FOR UPDATE
    `, [email]);

    if (accountResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Cuenta no encontrada' });
    }

    const account = accountResult.rows[0];
    const newBalance = Number(account.available_balance) + parsedAmount;

    await client.query(`
      UPDATE kueski_accounts
      SET available_balance = available_balance + $1,
          updated_at = NOW()
      WHERE id = $2
    `, [parsedAmount, account.id]);

    const planResult = await client.query(
      'SELECT id FROM payment_plans WHERE active = TRUE ORDER BY num_installments LIMIT 1'
    );
    const planId = planResult.rows[0]?.id || 1;

    const transactionResult = await client.query(`
      INSERT INTO transactions
        (account_id, plan_id, merchant_id, original_amount, discount_amount, total_amount, amount_per_installment, status)
      VALUES ($1, $2, NULL, $3, 0, $3, $3, 'loaned')
      RETURNING id, created_at
    `, [account.id, planId, parsedAmount.toFixed(2)]);

    await client.query(
      'INSERT INTO user_activity (merchant_id, action, details) VALUES (NULL, $1, $2)',
      ['loan_demo', `Préstamo demo de $${parsedAmount.toFixed(2)} acreditado a ${account.name}`]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      ok: true,
      new_balance: newBalance.toFixed(2),
      transaction: transactionResult.rows[0]
    });
  } catch (error) {
    if (client) {
      await client.query('ROLLBACK');
    }
    return res.status(500).json({ ok: false, error: error.message });
  } finally {
    if (client) {
      client.release();
    }
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

// Upcoming installments from purchases made inside the extension
app.get('/api/recordatorios', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ ok: false, error: 'email requerido' });

  try {
    const result = await db.query(`
      SELECT
        i.id,
        i.amount,
        i.due_date,
        i.status,
        i.paid_at,
        i.installment_no,
        t.id AS transaction_id,
        pp.num_installments,
        COALESCE(m.name, 'Kueski Pay') AS merchant
      FROM installments i
      JOIN transactions t ON t.id = i.transaction_id
      JOIN payment_plans pp ON pp.id = t.plan_id
      JOIN kueski_accounts ka ON ka.id = t.account_id
      JOIN users u ON u.id = ka.user_id
      LEFT JOIN merchants m ON m.id = t.merchant_id
      WHERE u.email = $1
        AND i.status = 'pending'
      ORDER BY i.due_date ASC
      LIMIT 50
    `, [email]);

    res.json({ ok: true, recordatorios: result.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post('/api/recordatorios/pagar', async (req, res) => {
  const { email, installment_id } = req.body || {};
  if (!email || !installment_id) {
    return res.status(400).json({ ok: false, error: 'email e installment_id son requeridos' });
  }

  let client;
  try {
    client = await db.pool.connect();
    await client.query('BEGIN');

    const installmentRes = await client.query(`
      SELECT
        i.id,
        i.amount,
        i.status,
        i.transaction_id,
        i.installment_no,
        t.status AS transaction_status,
        ka.id AS account_id,
        ka.available_balance,
        ka.used_balance,
        COALESCE(m.name, 'Kueski Pay') AS merchant
      FROM installments i
      JOIN transactions t ON t.id = i.transaction_id
      JOIN kueski_accounts ka ON ka.id = t.account_id
      JOIN users u ON u.id = ka.user_id
      LEFT JOIN merchants m ON m.id = t.merchant_id
      WHERE u.email = $1 AND i.id = $2
      FOR UPDATE OF i, ka
    `, [email, installment_id]);

    if (installmentRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Cuota no encontrada' });
    }

    const installment = installmentRes.rows[0];
    if (installment.status === 'paid') {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'Esta cuota ya fue pagada' });
    }

    const amount = parseFloat(installment.amount);
    const availableBalance = parseFloat(installment.available_balance);
    if (availableBalance < amount) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        ok: false,
        error: `Saldo insuficiente. Necesitas ${amount.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })} para pagar esta cuota.`,
      });
    }

    await client.query(`
      UPDATE installments
      SET status = 'paid', paid_at = NOW()
      WHERE id = $1
    `, [installment.id]);

    await client.query(`
      UPDATE kueski_accounts
      SET available_balance = available_balance - $1,
          used_balance = GREATEST(used_balance - $1, 0),
          updated_at = NOW()
      WHERE id = $2
    `, [amount.toFixed(2), installment.account_id]);

    const pendingRes = await client.query(`
      SELECT COUNT(*)::int AS pending_count
      FROM installments
      WHERE transaction_id = $1 AND status = 'pending'
    `, [installment.transaction_id]);

    const allPaid = pendingRes.rows[0].pending_count === 0;
    if (allPaid) {
      await client.query(`
        UPDATE transactions
        SET status = 'completed'
        WHERE id = $1
      `, [installment.transaction_id]);
    }

    const accountRes = await client.query(`
      SELECT available_balance, used_balance, credit_limit
      FROM kueski_accounts
      WHERE id = $1
    `, [installment.account_id]);

    await client.query('COMMIT');

    return res.json({
      ok: true,
      pago: {
        installment_id: installment.id,
        amount: amount.toFixed(2),
        merchant: installment.merchant,
        transaction_completed: allPaid,
      },
      cuenta: accountRes.rows[0],
    });
  } catch (err) {
    if (client) await client.query('ROLLBACK');
    return res.status(500).json({ ok: false, error: err.message });
  } finally {
    if (client) client.release();
  }
});

// Transfer balance between extension users
app.post('/api/transferencias', async (req, res) => {
  const { from_email, to, amount } = req.body || {};

  if (!from_email || !to || amount == null) {
    return res.status(400).json({ ok: false, error: 'from_email, to y amount son requeridos' });
  }

  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({ ok: false, error: 'amount debe ser un número válido mayor a 0' });
  }

  const recipientKey = String(to).trim();
  if (!recipientKey) {
    return res.status(400).json({ ok: false, error: 'Destinatario inválido' });
  }

  let client;
  try {
    client = await db.pool.connect();
    await client.query('BEGIN');

    const senderResult = await client.query(`
      SELECT u.id, u.email, u.name, ka.id AS account_id, ka.available_balance
      FROM users u
      JOIN kueski_accounts ka ON ka.user_id = u.id
      WHERE LOWER(u.email) = LOWER($1) AND ka.status = 'active'
      FOR UPDATE
    `, [from_email]);

    if (senderResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Cuenta del remitente no encontrada' });
    }

    const sender = senderResult.rows[0];
    const recipientQuery = recipientKey.includes('@')
      ? `LOWER(u.email) = LOWER($1)`
      : `LOWER(u.name) = LOWER($1)`;

    const recipientResult = await client.query(`
      SELECT u.id, u.email, u.name, ka.id AS account_id, ka.available_balance
      FROM users u
      JOIN kueski_accounts ka ON ka.user_id = u.id
      WHERE ${recipientQuery} AND ka.status = 'active'
      FOR UPDATE
    `, [recipientKey]);

    if (recipientResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ ok: false, error: 'Destinatario no encontrado. Debe estar registrado en la extensión.' });
    }

    const recipient = recipientResult.rows[0];

    if (sender.id === recipient.id) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'No puedes transferirte a ti mismo' });
    }

    if (parseFloat(sender.available_balance) < parsedAmount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'Saldo insuficiente' });
    }

    const senderNewBalance = parseFloat(sender.available_balance) - parsedAmount;
    const recipientNewBalance = parseFloat(recipient.available_balance) + parsedAmount;

    await client.query(`
      UPDATE kueski_accounts
      SET available_balance = $1, updated_at = NOW()
      WHERE id = $2
    `, [senderNewBalance.toFixed(2), sender.account_id]);

    await client.query(`
      UPDATE kueski_accounts
      SET available_balance = $1, updated_at = NOW()
      WHERE id = $2
    `, [recipientNewBalance.toFixed(2), recipient.account_id]);

    await client.query(
      'INSERT INTO user_activity (merchant_id, action, details) VALUES (NULL, $1, $2)',
      ['transfer_out', `Transferencia de $${parsedAmount.toFixed(2)} a ${recipient.email}`]
    );

    await client.query(
      'INSERT INTO user_activity (merchant_id, action, details) VALUES (NULL, $1, $2)',
      ['transfer_in', `Transferencia recibida de $${parsedAmount.toFixed(2)} de ${sender.email}`]
    );

    await client.query(`
      INSERT INTO user_transfers (from_account_id, to_account_id, amount)
      VALUES ($1, $2, $3)
    `, [sender.account_id, recipient.account_id, parsedAmount.toFixed(2)]);

    await client.query('COMMIT');

    return res.status(201).json({
      ok: true,
      transferencia: {
        amount: parsedAmount.toFixed(2),
        from: sender.email,
        to: recipient.email,
        sender_balance: senderNewBalance.toFixed(2),
        recipient_balance: recipientNewBalance.toFixed(2)
      }
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK');
    return res.status(500).json({ ok: false, error: error.message });
  } finally {
    if (client) client.release();
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
      SELECT * FROM (
        SELECT t.id, t.total_amount, t.original_amount, t.discount_amount,
               t.amount_per_installment, pp.num_installments, t.status, t.created_at,
               CASE
                 WHEN t.status = 'loaned'
                   OR (
                     t.merchant_id IS NULL
                     AND t.coupon_id IS NULL
                     AND NOT EXISTS (
                       SELECT 1 FROM installments i WHERE i.transaction_id = t.id
                     )
                   )
                 THEN 'Kueski Cash'
                 ELSE COALESCE(m.name, 'Kueski Pay')
               END AS merchant,
               CASE WHEN c.code IS NOT NULL THEN c.code || ' - ' || c.discount ELSE NULL END AS coupon_label,
               NULL::text AS transfer_from_name,
               NULL::text AS transfer_from_email,
               NULL::text AS transfer_to_name,
               NULL::text AS transfer_to_email,
               CASE
                 WHEN t.status = 'loaned'
                   OR (
                     t.merchant_id IS NULL
                     AND t.coupon_id IS NULL
                     AND NOT EXISTS (
                       SELECT 1 FROM installments i WHERE i.transaction_id = t.id
                     )
                   )
                 THEN TRUE
                 ELSE FALSE
               END AS is_loan
        FROM transactions t
        JOIN kueski_accounts ka ON ka.id = t.account_id
        JOIN users u            ON u.id  = ka.user_id
        JOIN payment_plans pp   ON pp.id = t.plan_id
        LEFT JOIN merchants m   ON m.id  = t.merchant_id
        LEFT JOIN coupons c     ON c.id  = t.coupon_id
        WHERE u.email = $1

        UNION ALL

        SELECT ut.id, ut.amount, ut.amount, 0,
               ut.amount, 1,
               CASE WHEN ut.from_account_id = ka.id THEN 'transfer_sent' ELSE 'transfer_received' END,
               ut.created_at,
               CASE
                 WHEN ut.from_account_id = ka.id THEN 'Transferencia a ' || u_to.name
                 ELSE 'Transferencia de ' || u_from.name
               END,
               NULL AS coupon_label,
               u_from.name AS transfer_from_name,
               u_from.email AS transfer_from_email,
               u_to.name AS transfer_to_name,
               u_to.email AS transfer_to_email,
               FALSE AS is_loan
        FROM user_transfers ut
        JOIN kueski_accounts ka ON ka.id = ut.from_account_id OR ka.id = ut.to_account_id
        JOIN users u ON u.id = ka.user_id
        JOIN kueski_accounts ka_from ON ka_from.id = ut.from_account_id
        JOIN users u_from ON u_from.id = ka_from.user_id
        JOIN kueski_accounts ka_to ON ka_to.id = ut.to_account_id
        JOIN users u_to ON u_to.id = ka_to.user_id
        WHERE u.email = $1
      ) activity
      ORDER BY created_at DESC
      LIMIT 10
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

  let client;
  try {
    client = await db.pool.connect();
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

    const creditLimit = parseFloat(cuenta.credit_limit);
    const usedBalance = parseFloat(cuenta.used_balance);
    const creditRemaining = creditLimit - usedBalance;
    if (total > creditRemaining) {
      await client.query('ROLLBACK');
      const remaining = Math.max(0, creditRemaining);
      return res.status(400).json({
        ok: false,
        error: `Superas tu límite de crédito. Te quedan $${remaining.toLocaleString('es-MX', { minimumFractionDigits: 2 })} disponibles para compras a plazos.`,
      });
    }

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
    if (client) {
      await client.query('ROLLBACK');
    }
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    if (client) {
      client.release();
    }
  }
});

//  Register a new user and create their Kueski account
app.post('/api/register', async (req, res) => {
  const { name, email } = req.body;
  if (!name || !email)
    return res.status(400).json({ ok: false, error: 'name and email are required' });

  let client;
  try {
    client = await db.pool.connect();
    await client.query('BEGIN');

    // Check if email already exists
    const existing = await client.query(
      'SELECT id FROM users WHERE email = $1', [email]
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ ok: false, error: 'Este correo ya está registrado' });
    }

    // Create the user
    const userRes = await client.query(
      'INSERT INTO users (email, name) VALUES ($1, $2) RETURNING *',
      [email, name]
    );
    const user = userRes.rows[0];

    // Create their Kueski account with demo credit limit until real approval exists
    await client.query(
      'INSERT INTO kueski_accounts (user_id, credit_limit, available_balance) VALUES ($1, $2, 0)',
      [user.id, DEMO_CREDIT_LIMIT]
    );

    await client.query('COMMIT');
    res.status(201).json({ ok: true, user: { id: user.id, name: user.name, email: user.email } });

  } catch (err) {
    if (client) {
      await client.query('ROLLBACK');
    }
    res.status(500).json({ ok: false, error: err.message });
  } finally {
    if (client) {
      client.release();
    }
  }
});


// Delete user account and all related data (cascades in DB)
app.delete('/api/cuenta', async (req, res) => {
  const { email } = req.body || {};
  if (!email) {
    return res.status(400).json({ ok: false, error: 'email requerido' });
  }

  try {
    const result = await db.query(
      'DELETE FROM users WHERE LOWER(email) = LOWER($1) RETURNING id',
      [email]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'Usuario no encontrado' });
    }

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});



async function ensureTransferSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_transfers (
      id SERIAL PRIMARY KEY,
      from_account_id INTEGER NOT NULL REFERENCES kueski_accounts(id) ON DELETE CASCADE,
      to_account_id INTEGER NOT NULL REFERENCES kueski_accounts(id) ON DELETE CASCADE,
      amount NUMERIC(12,2) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);

  // Prototype: assign fixed demo limit to accounts created before this feature
  await db.query(`
    UPDATE kueski_accounts
    SET credit_limit = $1, updated_at = NOW()
    WHERE credit_limit = 0
  `, [DEMO_CREDIT_LIMIT]);

  // Mark legacy Kueski Cash top-ups that were saved as purchases
  await db.query(`
    UPDATE transactions t
    SET status = 'loaned'
    WHERE t.status = 'authorized'
      AND t.merchant_id IS NULL
      AND t.coupon_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM installments i WHERE i.transaction_id = t.id
      )
  `);
}

ensureTransferSchema()
  .then(() => app.listen(PORT))
  .catch((err) => {
    console.error('Failed to initialize transfer schema:', err);
    process.exit(1);
  });


