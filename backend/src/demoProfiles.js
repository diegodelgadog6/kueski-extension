const DEMO_USERS = [
  {
    email: 'bueno@demo.com',
    password: 'Kueski2026',
    name: 'Ana García',
    tier: 'good',
    healthLabel: 'Salud buena',
    memberBadge: 'Miembro Premium',
    credit_limit: 20000,
    available_balance: 8000,
    used_balance: 0,
    credit_score: 780,
    status: 'active',
    features: { transfers: true, kueski_cash: true, purchases: true },
  },
  {
    email: 'regular@demo.com',
    password: 'Kueski2026',
    name: 'Luis Méndez',
    tier: 'regular',
    healthLabel: 'Salud regular',
    memberBadge: 'Miembro',
    credit_limit: 12000,
    available_balance: 4500,
    used_balance: 0,
    credit_score: 655,
    status: 'active',
    features: { transfers: true, kueski_cash: true, purchases: true },
  },
  {
    email: 'limitado@demo.com',
    password: 'Kueski2026',
    name: 'María López',
    tier: 'limited',
    healthLabel: 'Crédito limitado',
    memberBadge: 'Cuenta restringida',
    credit_limit: 6000,
    available_balance: 1500,
    used_balance: 0,
    credit_score: 510,
    status: 'restricted',
    features: { transfers: false, kueski_cash: false, purchases: false },
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
      overdue_count: overdueCount,
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

async function syncAccountUsedBalance(dbConn, accountId) {
  const result = await dbConn.query(`
    SELECT COALESCE(SUM(i.amount), 0)::numeric AS outstanding
    FROM installments i
    INNER JOIN transactions t ON t.id = i.transaction_id
    WHERE t.account_id = $1
      AND i.status = 'pending'
  `, [accountId]);

  const outstanding = parseFloat(result.rows[0]?.outstanding || 0);
  await dbConn.query(`
    UPDATE kueski_accounts
    SET used_balance = $1, updated_at = NOW()
    WHERE id = $2
  `, [outstanding.toFixed(2), accountId]);

  return outstanding;
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
          'INSERT INTO users (email, name, password) VALUES ($1, $2, $3) RETURNING id',
          [demo.email, demo.name, demo.password]
        );
        userId = inserted.rows[0].id;
      } else {
        userId = existingUser.rows[0].id;
        await client.query(
          'UPDATE users SET name = $1, password = $2 WHERE id = $3',
          [demo.name, demo.password, userId]
        );
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
  syncAccountUsedBalance,
  assertFeatureAllowed,
  scaleDiscountLabel,
  getHeroDiscountForTier,
  parseDiscountAmount,
  resolveCreditTier,
};
