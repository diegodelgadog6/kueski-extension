const DEMO_USERS = [
  {
    email: 'bueno@demo.com',
    name: 'Ana García',
    tier: 'good',
    healthLabel: 'Salud buena',
    memberBadge: 'Miembro Premium',
    credit_limit: 20000,
    available_balance: 15000,
    used_balance: 0,
    credit_score: 780,
    status: 'active',
    features: { transfers: true, kueski_cash: true, purchases: true },
    purchase: {
      merchant_domain: 'amazon.com.mx',
      total: 4500,
      num_installments: 3,
      installment_offsets: [-45, -30, -15],
      all_paid: true,
    },
  },
  {
    email: 'regular@demo.com',
    name: 'Luis Méndez',
    tier: 'regular',
    healthLabel: 'Salud regular',
    memberBadge: 'Miembro',
    credit_limit: 12000,
    available_balance: 3500,
    used_balance: 7000,
    credit_score: 655,
    status: 'active',
    features: { transfers: true, kueski_cash: true, purchases: true },
    purchase: {
      merchant_domain: 'liverpool.com.mx',
      total: 7000,
      num_installments: 3,
      installment_offsets: [12, 27, 42],
    },
  },
  {
    email: 'limitado@demo.com',
    name: 'María López',
    tier: 'limited',
    healthLabel: 'Crédito limitado',
    memberBadge: 'Cuenta restringida',
    credit_limit: 6000,
    available_balance: 500,
    used_balance: 5500,
    credit_score: 510,
    status: 'restricted',
    features: { transfers: false, kueski_cash: false, purchases: false },
    purchase: {
      merchant_domain: 'nike.com',
      total: 5500,
      num_installments: 3,
      installment_offsets: [-12, 18, 33],
    },
  },
];

const DEMO_EMAILS = new Set(DEMO_USERS.map((user) => user.email.toLowerCase()));

const TIER_DISCOUNT_SCALE = {
  good: 1,
  regular: 0.6,
  limited: 0.35,
};

const TIER_HERO_DISCOUNT = {
  good: '25% de descuento',
  regular: '12% de descuento',
  limited: '5% de descuento',
};

function scaleDiscountLabel(discount, tier) {
  const scale = TIER_DISCOUNT_SCALE[tier] ?? TIER_DISCOUNT_SCALE.good;
  const str = String(discount || '').trim();

  const pctMatch = str.match(/(\d+(?:\.\d+)?)\s*%/);
  if (pctMatch) {
    const value = Math.max(1, Math.round(parseFloat(pctMatch[1]) * scale));
    return `${value}% off`;
  }

  const fixedMatch = str.match(/\$\s*(\d+(?:\.\d+)?)/);
  if (fixedMatch) {
    const raw = parseFloat(fixedMatch[1]) * scale;
    const value = Math.max(50, Math.round(raw / 50) * 50);
    return `$${value.toLocaleString('es-MX')} off`;
  }

  const cashbackMatch = str.match(/(\d+(?:\.\d+)?)\s*%\s*cashback/i);
  if (cashbackMatch) {
    const value = Math.max(1, Math.round(parseFloat(cashbackMatch[1]) * scale));
    return `${value}% cashback`;
  }

  if (/msi/i.test(str)) {
    if (tier === 'limited') return 'MSI no disponible';
    if (tier === 'regular') return 'MSI selecto';
    return str;
  }

  return str;
}

function getHeroDiscountForTier(tier) {
  return TIER_HERO_DISCOUNT[tier] ?? TIER_HERO_DISCOUNT.good;
}

function parseDiscountAmount(discountLabel, monto) {
  const amount = parseFloat(monto);
  if (!amount || amount <= 0) return 0;

  const pct = String(discountLabel).match(/(\d+(?:\.\d+)?)\s*%/);
  const fixed = String(discountLabel).match(/\$\s*([\d,]+(?:\.\d+)?)/);
  let discount = 0;

  if (pct) discount = amount * (parseFloat(pct[1]) / 100);
  if (fixed) discount = parseFloat(fixed[1].replace(/,/g, ''));

  return Math.min(discount, amount);
}

async function resolveCreditTier(db, email) {
  if (!email) return 'good';

  const accountRes = await db.query(`
    SELECT u.email, ka.credit_limit, ka.used_balance, ka.status
    FROM users u
    JOIN kueski_accounts ka ON ka.user_id = u.id
    WHERE LOWER(u.email) = LOWER($1)
  `, [email]);

  if (accountRes.rows.length === 0) return 'good';

  const overdueCount = await countOverdueInstallments(db, email);
  const enriched = enrichAccountResponse(accountRes.rows[0], overdueCount);
  return enriched.credit_tier || 'good';
}

function getDemoProfile(email) {
  if (!email) return null;
  return DEMO_USERS.find((user) => user.email.toLowerCase() === email.toLowerCase()) || null;
}

function enrichAccountResponse(accountRow, overdueCount = 0) {
  const demo = getDemoProfile(accountRow.email);
  const usedPct = accountRow.credit_limit > 0
    ? Math.round((parseFloat(accountRow.used_balance) / parseFloat(accountRow.credit_limit)) * 100)
    : 0;

  if (demo) {
    return {
      ...accountRow,
      credit_tier: demo.tier,
      credit_health_label: demo.healthLabel,
      member_badge: demo.memberBadge,
      overdue_count: demo.tier === 'limited' ? 1 : 0,
      features: { ...demo.features },
    };
  }

  const hasOverdue = overdueCount > 0;
  let tier = 'good';
  let healthLabel = 'Salud buena';
  let memberBadge = 'Miembro';

  if (hasOverdue || accountRow.status === 'restricted' || usedPct >= 90) {
    tier = 'limited';
    healthLabel = 'Crédito limitado';
    memberBadge = accountRow.status === 'restricted' ? 'Cuenta restringida' : 'Miembro';
  } else if (usedPct >= 45) {
    tier = 'regular';
    healthLabel = 'Salud regular';
  }

  return {
    ...accountRow,
    credit_tier: tier,
    credit_health_label: healthLabel,
    member_badge: memberBadge,
    overdue_count: overdueCount,
    features: {
      transfers: accountRow.status === 'active' && !hasOverdue,
      kueski_cash: accountRow.status === 'active' && !hasOverdue,
      purchases: accountRow.status === 'active' && !hasOverdue,
    },
  };
}

async function countOverdueInstallments(db, email) {
  const result = await db.query(`
    SELECT COUNT(*)::int AS overdue_count
    FROM installments i
    JOIN transactions t ON t.id = i.transaction_id
    JOIN kueski_accounts ka ON ka.id = t.account_id
    JOIN users u ON u.id = ka.user_id
    WHERE u.email = $1
      AND i.status = 'pending'
      AND i.due_date < CURRENT_DATE
  `, [email]);

  return result.rows[0]?.overdue_count || 0;
}

async function seedDemoPurchase(client, accountId, purchase) {
  const merchantRes = await client.query(
    'SELECT id FROM merchants WHERE domain = $1 LIMIT 1',
    [purchase.merchant_domain]
  );
  const merchantId = merchantRes.rows[0]?.id || null;

  const planRes = await client.query(
    'SELECT id, num_installments FROM payment_plans WHERE num_installments = $1 AND active = TRUE LIMIT 1',
    [purchase.num_installments]
  );
  const plan = planRes.rows[0] || (await client.query(
    'SELECT id, num_installments FROM payment_plans WHERE active = TRUE ORDER BY num_installments LIMIT 1'
  )).rows[0];

  const total = purchase.total;
  const perInst = total / plan.num_installments;

  const txRes = await client.query(`
    INSERT INTO transactions
      (account_id, plan_id, merchant_id, original_amount, discount_amount, total_amount, amount_per_installment, status)
    VALUES ($1, $2, $3, $4, 0, $4, $5, 'authorized')
    RETURNING id
  `, [accountId, plan.id, merchantId, total.toFixed(2), perInst.toFixed(2)]);

  const transactionId = txRes.rows[0].id;
  const offsets = purchase.installment_offsets;

  const allPaid = purchase.all_paid === true;

  for (let i = 0; i < plan.num_installments; i += 1) {
    const offsetDays = offsets[i] ?? (i + 1) * 15;
    const status = allPaid ? 'paid' : 'pending';
    await client.query(`
      INSERT INTO installments (transaction_id, installment_no, amount, due_date, status, paid_at)
      VALUES ($1, $2, $3, CURRENT_DATE + ($4 * INTERVAL '1 day'), $5, $6)
    `, [transactionId, i + 1, perInst.toFixed(2), offsetDays, status, allPaid ? new Date() : null]);
  }
}

async function ensureDemoUsers(db) {
  for (const demo of DEMO_USERS) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      let userId;
      const existingUser = await client.query(
        'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
        [demo.email]
      );

      if (existingUser.rows.length === 0) {
        const inserted = await client.query(
          'INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id',
          [demo.email, demo.name]
        );
        userId = inserted.rows[0].id;
      } else {
        userId = existingUser.rows[0].id;
        await client.query('UPDATE users SET name = $1 WHERE id = $2', [demo.name, userId]);
      }

      const existingAccount = await client.query(
        'SELECT id FROM kueski_accounts WHERE user_id = $1',
        [userId]
      );

      let accountId;
      if (existingAccount.rows.length === 0) {
        const insertedAccount = await client.query(`
          INSERT INTO kueski_accounts
            (user_id, credit_limit, available_balance, used_balance, credit_score, status)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id
        `, [
          userId,
          demo.credit_limit,
          demo.available_balance,
          demo.used_balance,
          demo.credit_score,
          demo.status,
        ]);
        accountId = insertedAccount.rows[0].id;
      } else {
        accountId = existingAccount.rows[0].id;
        await client.query(`
          UPDATE kueski_accounts
          SET credit_limit = $1,
              available_balance = $2,
              used_balance = $3,
              credit_score = $4,
              status = $5,
              updated_at = NOW()
          WHERE id = $6
        `, [
          demo.credit_limit,
          demo.available_balance,
          demo.used_balance,
          demo.credit_score,
          demo.status,
          accountId,
        ]);
      }

      await client.query(`
        DELETE FROM installments
        WHERE transaction_id IN (SELECT id FROM transactions WHERE account_id = $1)
      `, [accountId]);
      await client.query('DELETE FROM transactions WHERE account_id = $1', [accountId]);
      await client.query(`
        DELETE FROM user_transfers
        WHERE from_account_id = $1 OR to_account_id = $1
      `, [accountId]);

      await seedDemoPurchase(client, accountId, demo.purchase);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function assertFeatureAllowed(db, email, feature) {
  const accountRes = await db.query(`
    SELECT u.email, u.name, ka.credit_limit, ka.used_balance, ka.available_balance,
           ka.credit_score, ka.status
    FROM users u
    JOIN kueski_accounts ka ON ka.user_id = u.id
    WHERE LOWER(u.email) = LOWER($1)
  `, [email]);

  if (accountRes.rows.length === 0) {
    const error = new Error('Cuenta no encontrada');
    error.statusCode = 404;
    throw error;
  }

  const overdueCount = await countOverdueInstallments(db, email);
  const enriched = enrichAccountResponse(accountRes.rows[0], overdueCount);
  const allowed = enriched.features?.[feature];

  if (!allowed) {
    const messages = {
      transfers: 'Las transferencias no están disponibles con tu estatus de crédito actual.',
      kueski_cash: 'Kueski Cash no está disponible con tu estatus de crédito actual.',
      purchases: 'Las compras con Kueski Pay están bloqueadas por pagos vencidos o crédito limitado.',
    };
    const error = new Error(messages[feature] || 'Función no disponible');
    error.statusCode = 403;
    throw error;
  }
}

module.exports = {
  DEMO_USERS,
  DEMO_EMAILS,
  getDemoProfile,
  enrichAccountResponse,
  countOverdueInstallments,
  ensureDemoUsers,
  assertFeatureAllowed,
  scaleDiscountLabel,
  getHeroDiscountForTier,
  parseDiscountAmount,
  resolveCreditTier,
};
