// Track the currently logged-in user
let currentUserEmail = null;
let currentAccountProfile = null;
let allStoresData = [];
let activeStoreCategory = 'Todas';
let pendingInstallmentId = null;
let currentTransactionId = null;
let cardCvvVisible = false;
let currentCardNumber = '';

const STORE_META = {
  'amazon.com.mx': { icon: '🛒', slug: 'amazon', category: 'Electrónica, Hogar' },
  'liverpool.com.mx': { icon: '🏬', slug: 'liverpool', category: 'Moda, Hogar' },
  'privalia.com.mx': { icon: '👗', slug: 'privalia', category: 'Moda' },
  'nike.com': { icon: '👟', slug: 'nike', category: 'Deportes' },
  'zara.com': { icon: '👔', slug: 'zara', category: 'Moda' },
  'att.com.mx': { icon: '📱', slug: 'att', category: 'Electrónica' },
  'officedepot.com.mx': { icon: '🖨️', slug: 'office depot', category: 'Oficina' },
  'puma.com': { icon: '🐆', slug: 'puma', category: 'Deportes' },
  'adidas.com.mx': { icon: '👟', slug: 'adidas', category: 'Deportes' },
  'shein.com': { icon: '👚', slug: 'shein', category: 'Moda' },
};

function parseDiscountFromLabel(discountLabel, amount) {
  const pct = String(discountLabel).match(/(\d+(?:\.\d+)?)\s*%/);
  const fixed = String(discountLabel).match(/\$\s*([\d,]+(?:\.\d+)?)/);
  let discount = 0;
  if (pct) discount = amount * (parseFloat(pct[1]) / 100);
  if (fixed) discount = parseFloat(fixed[1].replace(/,/g, ''));
  return Math.min(discount, amount);
}

function setSitePromoState(state) {
  const card = document.querySelector('.discount-card');
  const hint = document.getElementById('site-promo-hint');
  if (card) card.classList.toggle('hidden', state !== 'affiliated');
  if (hint) hint.classList.toggle('hidden', state !== 'unaffiliated');
}

function isCheckoutPageUrl(url) {
  if (!url) return false;
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'http:' && protocol !== 'https:') return false;
    return Boolean(hostname);
  } catch (_err) {
    return false;
  }
}

async function resolveActivePageDomain() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (isCheckoutPageUrl(tab?.url)) {
      return new URL(tab.url).hostname.replace(/^www\./i, '');
    }
  } catch (_err) {
    // Fall through to stored domain when tab URL is unavailable (e.g. popup opened from banner).
  }

  const stored = await chrome.storage.session.get(['activeMerchantDomain']);
  return stored.activeMerchantDomain?.replace(/^www\./i, '') || null;
}

function renderCouponMini(store) {
  const meta = STORE_META[store.domain] || { icon: '🏪' };
  const expiry = store.expires_at
    ? new Date(store.expires_at).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })
    : '31 de Dic 2026';

  return `
    <div class="coupon-mini" data-action="coupon-detail" data-feature="purchases"
      data-code="${escapeHtmlAttr(store.code)}"
      data-amount="${escapeHtmlAttr(store.discount)}"
      data-desc="Válido en ${escapeHtmlAttr(store.name)} con Kueski Pay."
      data-expiry="${escapeHtmlAttr(expiry)}">
      <div class="coupon-mini-icon">${meta.icon}</div>
      <div class="coupon-mini-info">
        <strong>${escapeHtmlAttr(store.name)}</strong>
        <span>${escapeHtmlAttr(store.discount)}</span>
      </div>
    </div>
  `;
}

function renderStoreRow(store) {
  const meta = STORE_META[store.domain] || { icon: '🏪', slug: store.name.toLowerCase(), category: 'Tienda afiliada' };

  return `
    <div class="store-row" data-name="${escapeHtmlAttr(meta.slug)}">
      <div class="store-row-icon">${meta.icon}</div>
      <div class="store-row-info">
        <strong>${escapeHtmlAttr(store.name)}</strong>
        <span>Hasta ${escapeHtmlAttr(store.discount)} • ${escapeHtmlAttr(meta.category)}</span>
      </div>
      <span class="material-symbols-outlined store-arrow">chevron_right</span>
    </div>
  `;
}

async function loadTierStoreOffers() {
  const couponsScroll = document.querySelector('.coupons-scroll');
  const storesList = document.getElementById('stores-list');
  if (!couponsScroll || !storesList) return;

  const emailParam = currentUserEmail
    ? `?email=${encodeURIComponent(currentUserEmail)}`
    : '';

  try {
    const res = await fetch(`http://localhost:3000/api/cupones/tiendas${emailParam}`);
    const data = await res.json();
    if (!data.ok || !Array.isArray(data.tiendas)) return;

    allStoresData = data.tiendas;
    const featured = data.tiendas.slice(0, 4);
    couponsScroll.innerHTML = featured.map(renderCouponMini).join('');
    renderStoresList();
  } catch (err) {
    console.error('Error loading tier store offers:', err);
  }
}

function storeMatchesFilters(store) {
  const meta = STORE_META[store.domain] || {
    slug: store.name.toLowerCase(),
    category: 'Tienda afiliada',
  };
  const categoryText = meta.category.toLowerCase();
  const name = store.name.toLowerCase();
  const slug = meta.slug.toLowerCase();
  const query = document.getElementById('store-search')?.value.toLowerCase().trim() || '';

  const matchesCategory = activeStoreCategory === 'Todas'
    || categoryText.includes(activeStoreCategory.toLowerCase());
  const matchesSearch = !query
    || name.includes(query)
    || slug.includes(query)
    || categoryText.includes(query);

  return matchesCategory && matchesSearch;
}

function bindStoreRows() {
  document.querySelectorAll('#stores-list .store-row').forEach((row) => {
    if (row.dataset.bound === 'true') return;
    row.dataset.bound = 'true';
    row.style.cursor = 'pointer';
    row.addEventListener('click', (e) => {
      e.stopPropagation();
      openStore(row.getAttribute('data-name'));
    });
  });
}

function renderStoresList() {
  const storesList = document.getElementById('stores-list');
  if (!storesList) return;

  const filtered = allStoresData.filter(storeMatchesFilters);

  if (filtered.length === 0) {
    storesList.innerHTML =
      '<p style="text-align:center;padding:1rem;opacity:0.5">No hay tiendas que coincidan</p>';
    return;
  }

  storesList.innerHTML = filtered.map(renderStoreRow).join('');
  bindStoreRows();
}

function applyCreditProfile(c) {
  if (!c) return;
  currentAccountProfile = c;

  const tier = c.credit_tier || 'good';
  const healthLabel = c.credit_health_label || 'Salud buena';
  const features = c.features || {};

  const healthEl = document.getElementById('credit-health-label');
  if (healthEl) healthEl.textContent = healthLabel;

  const memberBadge = document.getElementById('member-badge');
  if (memberBadge) memberBadge.textContent = c.member_badge || 'Miembro';

  const balanceStatus = document.getElementById('balance-status');
  if (balanceStatus) {
    if (tier === 'limited' || c.status === 'restricted') {
      balanceStatus.className = 'balance-status balance-status-warning';
      balanceStatus.innerHTML =
        '<span class="material-symbols-outlined tiny">warning</span> Crédito limitado';
    } else {
      balanceStatus.className = 'balance-status balance-status-active';
      balanceStatus.innerHTML =
        '<span class="material-symbols-outlined tiny">check_circle</span> Cuenta activa';
    }
  }

  const homeCreditCard = document.querySelector('#tab-home .credit-card');
  if (homeCreditCard) {
    homeCreditCard.classList.remove('credit-health-good', 'credit-health-regular', 'credit-health-limited');
    homeCreditCard.classList.add(`credit-health-${tier}`);
    const fill = homeCreditCard.querySelector('.progress-fill');
    if (fill) {
      fill.classList.remove('progress-fill-good', 'progress-fill-regular', 'progress-fill-limited');
      fill.classList.add(`progress-fill-${tier}`);
    }
  }

  const accountFill = document.querySelector('#tab-account .progress-fill');
  if (accountFill) {
    accountFill.classList.remove('progress-fill-good', 'progress-fill-regular', 'progress-fill-limited');
    accountFill.classList.add(`progress-fill-${tier}`);
  }

  document.querySelectorAll('[data-feature]').forEach((el) => {
    const feature = el.dataset.feature;
    const enabled = features[feature] !== false;
    el.classList.toggle('feature-disabled', !enabled);
    if (el.tagName === 'BUTTON') el.disabled = !enabled;
  });

  const banner = document.getElementById('account-restricted-banner');
  if (banner) {
    const showBanner = tier === 'limited' || (c.overdue_count || 0) > 0;
    banner.classList.toggle('hidden', !showBanner);
  }
}

function ensureFeatureAccess(feature, message) {
  if (currentAccountProfile?.features?.[feature] === false) {
    alert(message);
    return false;
  }
  return true;
}

// Restore session when popup opens
chrome.storage.local.get('userEmail', (result) => {
  if (result.userEmail) {
    currentUserEmail = result.userEmail;
    navigate('home');
  }
});


// ===== VIEW NAVIGATION =====
function navigate(viewName) {
  document
    .querySelectorAll(".view")
    .forEach((v) => v.classList.remove("active"));

  if (["home", "stores", "card", "activity", "account"].includes(viewName)) {
    document.getElementById("view-app").classList.add("active");
    switchTab(viewName);
    loadAccountData(); // Load account data when navigating to app views
  } else {
    const view = document.getElementById("view-" + viewName);
    if (view) view.classList.add("active");
  }
}

// ===== TAB SWITCHING =====
function switchTab(tabName) {
  document
    .querySelectorAll(".tab")
    .forEach((t) => t.classList.remove("active"));
  document
    .querySelectorAll(".nav-item")
    .forEach((n) => n.classList.remove("active"));

  const tab = document.getElementById("tab-" + tabName);
  if (tab) tab.classList.add("active");

  const navItems = document.querySelectorAll(".nav-item");
  const tabOrder = ["home", "stores", "card", "activity", "account"];
  const idx = tabOrder.indexOf(tabName);
  if (idx >= 0 && navItems[idx]) navItems[idx].classList.add("active");

  // Scroll to top
  document.getElementById("app-content").scrollTop = 0;

  // Load real data when switching tabs from the DB
  if (tabName === "activity") loadActivityData();
  if (tabName === "account") loadAccountTab();
  if (tabName === "card") loadKueskiCard();
}


function getCreditUsagePercent(usedBalance, creditLimit) {
  const limit = parseFloat(creditLimit);
  const used = parseFloat(usedBalance);
  if (!limit || limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

function formatCardNumberDisplay(number) {
  return String(number || '').replace(/\D/g, '').match(/.{1,4}/g)?.join(' ') || '—';
}

function resetCardCvvDisplay() {
  cardCvvVisible = false;
  const cvvEl = document.getElementById('kc-cvv');
  const iconEl = document.getElementById('kc-cvv-icon');
  if (cvvEl) cvvEl.textContent = '•••';
  if (iconEl) iconEl.textContent = 'visibility';
}

async function loadKueskiCard() {
  if (!currentUserEmail) return;

  resetCardCvvDisplay();

  const cardEl = document.getElementById('kueski-card');
  const statusNote = document.getElementById('kueski-card-status-note');
  const shell = document.getElementById('kueski-card-shell');

  if (shell) shell.classList.remove('kueski-card-shell-inactive');

  try {
    const res = await fetch(
      `http://localhost:3000/api/tarjeta?email=${encodeURIComponent(currentUserEmail)}`
    );
    const data = await res.json();
    if (!data.ok) return;

    const t = data.tarjeta;
    currentCardNumber = t.card_number || '';

    document.getElementById('kc-number').textContent = formatCardNumberDisplay(t.card_number);
    document.getElementById('kc-holder').textContent = t.cardholder_name || '—';
    document.getElementById('kc-expiry').textContent = t.expiry || '—';

    if (cardEl) {
      cardEl.classList.remove('credit-health-good', 'credit-health-regular', 'credit-health-limited');
      cardEl.classList.add(`credit-health-${t.credit_tier || 'good'}`);
    }

    if (statusNote) {
      if (!t.card_active) {
        statusNote.textContent =
          'Tu tarjeta está pausada por estatus de crédito. Regulariza tu cuenta para volver a usarla.';
        statusNote.classList.remove('hidden');
        shell?.classList.add('kueski-card-shell-inactive');
      } else {
        statusNote.classList.add('hidden');
      }
    }
  } catch (err) {
    console.error('Error loading Kueski card:', err);
  }
}

async function toggleCardCvv() {
  if (!currentUserEmail) return;

  const cvvEl = document.getElementById('kc-cvv');
  const iconEl = document.getElementById('kc-cvv-icon');
  if (!cvvEl || !iconEl) return;

  if (cardCvvVisible) {
    resetCardCvvDisplay();
    return;
  }

  try {
    const res = await fetch('http://localhost:3000/api/tarjeta/cvv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: currentUserEmail }),
    });
    const data = await res.json();

    if (!data.ok) {
      alert(data.error || 'No se pudo generar el CVV');
      return;
    }

    cardCvvVisible = true;
    cvvEl.textContent = data.cvv;
    iconEl.textContent = 'visibility_off';
  } catch (err) {
    console.error('Error generating CVV:', err);
    alert('No se pudo conectar al servidor');
  }
}

function copyCardNumber() {
  if (!currentCardNumber) return;

  navigator.clipboard.writeText(currentCardNumber.replace(/\D/g, '')).then(() => {
    const btn = document.querySelector('[data-action="copy-card-number"]');
    if (!btn) return;
    const original = btn.innerHTML;
    btn.innerHTML = '<span class="material-symbols-outlined tiny">check</span> Copiado';
    setTimeout(() => {
      btn.innerHTML = original;
    }, 1500);
  });
}

// Load real account data from the API
async function loadAccountData() {
  const email = currentUserEmail;
  if (!email) return;

  try {
    const res = await fetch(`http://localhost:3000/api/cuenta?email=${email}`);
    const data = await res.json();
    if (!data.ok) return;

    const c = data.cuenta;
    applyCreditProfile(c);

    // Update balance (Home tab)
    const homeBalance = document.querySelector('#tab-home .balance-amount');
    if (homeBalance) {
      homeBalance.textContent = formatMoneyValue(c.available_balance);
    }

    // Update credit usage card (Home tab)
    const homeCreditCard = document.querySelector('#tab-home .credit-card');
    if (homeCreditCard) {
      const usedPct = getCreditUsagePercent(c.used_balance, c.credit_limit);
      homeCreditCard.querySelector('.credit-pct').textContent = usedPct + '%';
      homeCreditCard.querySelector('.progress-fill').style.width = usedPct + '%';
      homeCreditCard.querySelector('.credit-range span:first-child').textContent =
        formatMoneyValue(c.used_balance) + ' Usado';
      homeCreditCard.querySelector('.credit-range span:last-child').textContent =
        formatMoneyValue(c.credit_limit) + ' Límite';
    }

    // Update account tab limit label (full load happens in loadAccountTab)
    const creditLimitVal = document.querySelector('.credit-limit-val');
    if (creditLimitVal) {
      creditLimitVal.textContent = formatMoneyValue(c.credit_limit);
    }
  } catch (err) {
    console.error("Error loading account data:", err);
  }

  loadCurrentSiteCoupon();
  updateRemindersIndicator();
  loadTierStoreOffers();
}

async function updateRemindersIndicator() {
  const dot = document.getElementById('reminders-indicator');
  if (!dot) return;

  if (!currentUserEmail) {
    dot.classList.add('hidden');
    return;
  }

  try {
    const res = await fetch(
      `http://localhost:3000/api/recordatorios?email=${encodeURIComponent(currentUserEmail)}`
    );
    const data = await res.json();
    const hasPending = data.ok && Array.isArray(data.recordatorios) && data.recordatorios.length > 0;
    dot.classList.toggle('hidden', !hasPending);
  } catch (err) {
    dot.classList.add('hidden');
  }
}

// Fetch account + transactions from the backend for this user
function getPurchasePaymentStatusLabel(tx) {
  if (tx.status === 'completed') return 'PAGO COMPLETADO';
  return 'PAGO PENDIENTE';
}

function getActivityStatusLabel(tx) {
  if (tx.status === 'transfer_sent') return 'ENVIADA';
  if (tx.status === 'transfer_received') return 'RECIBIDA';
  if (getActivityKind(tx) === 'loan') return 'ACREDITADO';
  if (getActivityKind(tx) === 'purchase') return getPurchasePaymentStatusLabel(tx);
  if (tx.status === 'completed') return 'PAGADO';
  return String(tx.status || '').toUpperCase();
}

function getActivityStatusClass(tx) {
  if (tx.status === 'transfer_received') return 'paid';
  if (getActivityKind(tx) === 'loan') return 'paid';
  if (getActivityKind(tx) === 'purchase' && tx.status === 'completed') return 'paid';
  if (tx.status === 'transfer_sent') return 'paid';
  if (tx.status === 'completed') return 'paid';
  return 'pending';
}

function getActivityIcon(tx) {
  if (tx.status === 'transfer_sent' || tx.status === 'transfer_received') return '💸';
  if (getActivityKind(tx) === 'loan') return '💰';
  return '🛒';
}

function getActivityTypeLabel(tx) {
  if (tx.status === 'transfer_sent' || tx.status === 'transfer_received') return 'Transferencia';
  if (getActivityKind(tx) === 'loan') return 'Acreditación';
  return 'Crédito';
}

function formatMoneyValue(amount) {
  return '$' + parseFloat(amount || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 });
}

function escapeHtmlAttr(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function getTransactionDetailStatus(tx) {
  if (tx.status === 'transfer_received') return 'RECIBIDA';
  if (tx.status === 'transfer_sent') return 'ENVIADA';
  if (getActivityKind(tx) === 'loan') return 'ACREDITADO';
  if (getActivityKind(tx) === 'purchase') return getPurchasePaymentStatusLabel(tx);
  if (tx.status === 'completed') return 'PAGADO';
  return getActivityStatusLabel(tx);
}

function getTransactionCouponLabel(tx) {
  return tx.coupon_label || 'Ninguno';
}

function getTransactionInstallmentsLabel(tx) {
  if (getActivityKind(tx) !== 'purchase') return '';
  return `${tx.num_installments || 0} quincenas`;
}

function isLoanTransaction(tx) {
  return tx.is_loan === true
    || tx.is_loan === 't'
    || tx.status === 'loaned'
    || tx.merchant === 'Kueski Cash'
    || tx.merchant === 'Préstamo demo';
}

function getActivityKind(tx) {
  if (tx.status === 'transfer_sent' || tx.status === 'transfer_received') return 'transfer';
  if (isLoanTransaction(tx)) return 'loan';
  return 'purchase';
}

function formatPersonLabel(name, email) {
  if (name && email) return `${name}\n${email}`;
  return name || email || '—';
}

function getActivityHeroTitle(tx, kind) {
  if (kind === 'transfer') {
    return tx.status === 'transfer_sent' ? 'Transferencia enviada' : 'Transferencia recibida';
  }
  if (kind === 'loan') return 'Kueski Cash';
  return tx.merchant || 'Kueski Pay';
}

function getActivityKindLabel(kind) {
  if (kind === 'transfer') return 'Transferencia';
  if (kind === 'loan') return 'Kueski Cash';
  return 'Compra';
}

function setTransactionDetailBadge(status) {
  const badge = document.getElementById('txd-status-badge');
  badge.textContent = status || 'PENDIENTE';
  const isPaid = ['PAGADO', 'RECIBIDA', 'ENVIADA', 'ACREDITADO', 'PAGO COMPLETADO'].includes(status);
  badge.className = 'tx-detail-badge ' + (isPaid ? 'paid' : 'pending');
}

function getInstallmentTimelineState(installment, firstPendingNo) {
  if (installment.status === 'paid') return 'paid';
  if (firstPendingNo != null && installment.installment_no === firstPendingNo) return 'current';
  return 'locked';
}

function renderInstallmentTimeline(cuotas) {
  const container = document.getElementById('txd-installment-timeline');
  const progressLabel = document.getElementById('txd-installment-progress');
  if (!container) return;

  const total = cuotas[0]?.num_installments || cuotas.length;
  const paidCount = cuotas.filter((c) => c.status === 'paid').length;
  const firstPending = cuotas.find((c) => c.status === 'pending');
  const firstPendingNo = firstPending?.installment_no ?? null;

  if (progressLabel) {
    progressLabel.textContent = paidCount >= total
      ? 'Todas las quincenas pagadas'
      : `${paidCount} de ${total} quincenas pagadas`;
  }

  pendingInstallmentId = firstPending?.id ?? null;

  if (paidCount >= total) {
    setTransactionDetailBadge('PAGO COMPLETADO');
  }

  container.innerHTML = cuotas.map((item, index) => {
    const state = getInstallmentTimelineState(item, firstPendingNo);
    const amount = parseFloat(item.amount);
    const dueText = formatReminderDate(item.due_date);
    const isLast = index === cuotas.length - 1;

    let statusHtml = '';
    if (state === 'paid') {
      const paidDate = item.paid_at ? formatReminderDate(item.paid_at) : '';
      statusHtml = `
        <span class="timeline-status timeline-status-paid">
          <span class="material-symbols-outlined tiny">check_circle</span> Pagada${paidDate ? ` · ${paidDate}` : ''}
        </span>`;
    } else if (state === 'current') {
      const badge = getReminderBadge(item.due_date, false);
      statusHtml = `
        <span class="timeline-status timeline-status-current ${badge.status === 'danger' ? 'is-overdue' : ''}">${badge.label}</span>
        <button class="btn-timeline-pay" type="button"
          data-action="pay-installment-timeline"
          data-installment-id="${item.id}">Pagar quincena</button>`;
    } else {
      statusHtml = `
        <span class="timeline-status timeline-status-locked">
          <span class="material-symbols-outlined tiny">lock</span> Disponible después
        </span>`;
    }

    return `
      <div class="timeline-item timeline-item-${state}${isLast ? ' timeline-item-last' : ''}">
        <div class="timeline-track">
          <span class="timeline-dot"></span>
          ${isLast ? '' : '<span class="timeline-line"></span>'}
        </div>
        <div class="timeline-content">
          <div class="timeline-head">
            <strong>Quincena ${item.installment_no} de ${total}</strong>
            <span class="timeline-amount">${formatMoneyValue(amount)}</span>
          </div>
          <span class="timeline-due">Vence ${dueText}</span>
          ${statusHtml}
        </div>
      </div>
    `;
  }).join('');
}

async function loadInstallmentTimeline(transactionId) {
  const section = document.getElementById('txd-pay-section');
  const container = document.getElementById('txd-installment-timeline');
  if (!section || !container) return;

  if (!transactionId || !currentUserEmail) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  container.innerHTML = '<p class="timeline-loading">Cargando quincenas...</p>';

  try {
    const res = await fetch(
      `http://localhost:3000/api/transacciones/${transactionId}/cuotas?email=${encodeURIComponent(currentUserEmail)}`
    );
    const data = await res.json();

    if (!data.ok || !Array.isArray(data.cuotas) || data.cuotas.length === 0) {
      section.classList.add('hidden');
      return;
    }

    renderInstallmentTimeline(data.cuotas);
  } catch (err) {
    console.error('Error loading installment timeline:', err);
    container.innerHTML = '<p class="timeline-loading">No se pudieron cargar las quincenas</p>';
  }
}

async function showTransactionDetail(row) {
  const d = row.dataset;
  const kind = d.type || 'purchase';
  pendingInstallmentId = null;
  currentTransactionId = d.transactionId || null;

  document.getElementById('txd-kind').textContent = getActivityKindLabel(kind);
  document.getElementById('txd-store').textContent = d.store || 'Kueski Pay';
  document.getElementById('txd-date').textContent = d.date || '';
  setTransactionDetailBadge(d.status);

  document.getElementById('txd-purchase-details').classList.add('hidden');
  document.getElementById('txd-transfer-details').classList.add('hidden');
  document.getElementById('txd-loan-details').classList.add('hidden');
  document.getElementById('txd-pay-section')?.classList.add('hidden');

  if (kind === 'purchase') {
    document.getElementById('txd-original').textContent = d.original || d.amount || '$0.00';
    document.getElementById('txd-coupon').textContent = d.coupon || 'Ninguno';
    document.getElementById('txd-savings').textContent = d.savings || '$0.00';
    document.getElementById('txd-amount').textContent = d.amount || '$0.00';
    document.getElementById('txd-installments').textContent = d.installments || '—';
    document.getElementById('txd-installment-amount').textContent = d.installmentAmount || '$0.00';
    document.getElementById('txd-method').textContent = d.method || 'Kueski Pay - Crédito';
    document.getElementById('txd-purchase-details').classList.remove('hidden');
    await loadInstallmentTimeline(currentTransactionId);
  } else if (kind === 'transfer') {
    const isSent = d.status === 'ENVIADA';
    document.getElementById('txd-transfer-type').textContent = isSent ? 'Enviada' : 'Recibida';
    document.getElementById('txd-transfer-from').textContent =
      formatPersonLabel(d.fromName, d.fromEmail);
    document.getElementById('txd-transfer-to').textContent =
      formatPersonLabel(d.toName, d.toEmail);
    document.getElementById('txd-transfer-amount').textContent = d.amount || '$0.00';
    document.getElementById('txd-transfer-details').classList.remove('hidden');
  } else if (kind === 'loan') {
    document.getElementById('txd-loan-amount').textContent = d.amount || '$0.00';
    document.getElementById('txd-loan-status').textContent = 'Acreditado';
    document.getElementById('txd-loan-details').classList.remove('hidden');
  }

  document.getElementById('transaction-overlay').classList.remove('hidden');
}

function closeTransactionDetail() {
  pendingInstallmentId = null;
  currentTransactionId = null;
  document.getElementById('transaction-overlay').classList.add('hidden');
}

async function loadActivityData() {
  const email = currentUserEmail;
  if (!email) return;

  try {
    const res = await fetch(`http://localhost:3000/api/cuenta?email=${email}`);
    const data = await res.json();
    if (!data.ok) return;

    const txs = data.ultimas_transacciones;
    const list = document.querySelector(".transactions-list");

    // Calculate real totals from DB activity (exclude incoming transfers from "gastado")
    const totalSpent = txs.reduce((sum, tx) => {
      if (tx.status === 'transfer_received') return sum;
      if (getActivityKind(tx) === 'loan') return sum;
      return sum + parseFloat(tx.total_amount);
    }, 0);
    const totalSaved = txs.reduce((sum, tx) => {
      if (getActivityKind(tx) !== 'purchase') return sum;
      return sum + parseFloat(tx.discount_amount || 0);
    }, 0);

    // Update stat cards with real data
    document.querySelector('.stat-card.stat-primary .stat-value').textContent =
      '$' + totalSpent.toLocaleString('es-MX', { minimumFractionDigits: 2 });
    document.querySelector('.stat-card.stat-secondary .stat-value').textContent =
      '$' + totalSaved.toLocaleString('es-MX', { minimumFractionDigits: 2 });

    // No transactions yet — show empty state
    if (txs.length === 0) {
      list.innerHTML =
        '<p style="text-align:center;padding:1rem;opacity:0.5">Sin transacciones aún</p>';
      return;
    }

    // Build a row for each transaction returned by the API
    list.innerHTML = txs
      .map((tx) => {
        const kind = getActivityKind(tx);
        const statusLabel = getTransactionDetailStatus(tx);
        const formattedDate = new Date(tx.created_at).toLocaleDateString('es-MX', {
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        });
        const heroTitle = getActivityHeroTitle(tx, kind);

        return `
      <div class="transaction-row" data-action="transaction-detail"
        data-transaction-id="${escapeHtmlAttr(tx.id)}"
        data-type="${escapeHtmlAttr(kind)}"
        data-store="${escapeHtmlAttr(heroTitle)}"
        data-date="${escapeHtmlAttr(formattedDate)}"
        data-original="${escapeHtmlAttr(formatMoneyValue(tx.original_amount))}"
        data-amount="${escapeHtmlAttr(formatMoneyValue(tx.total_amount))}"
        data-status="${escapeHtmlAttr(statusLabel)}"
        data-method="Kueski Pay - Crédito"
        data-installments="${escapeHtmlAttr(getTransactionInstallmentsLabel(tx))}"
        data-installment-amount="${escapeHtmlAttr(formatMoneyValue(tx.amount_per_installment))}"
        data-coupon="${escapeHtmlAttr(getTransactionCouponLabel(tx))}"
        data-savings="${escapeHtmlAttr(formatMoneyValue(tx.discount_amount))}"
        data-next-installment-id="${escapeHtmlAttr(tx.next_installment_id || '')}"
        data-next-installment-due="${escapeHtmlAttr(tx.next_installment_due_date ? formatReminderDate(tx.next_installment_due_date) : '')}"
        data-from-name="${escapeHtmlAttr(tx.transfer_from_name || '')}"
        data-from-email="${escapeHtmlAttr(tx.transfer_from_email || '')}"
        data-to-name="${escapeHtmlAttr(tx.transfer_to_name || '')}"
        data-to-email="${escapeHtmlAttr(tx.transfer_to_email || '')}">
        <div class="tx-icon">${getActivityIcon(tx)}</div>
        <div class="tx-info">
          <strong>${tx.merchant || "Kueski Pay"}</strong>
          <span>${formattedDate} • ${getActivityTypeLabel(tx)}</span>
        </div>
        <div class="tx-amount">
          <strong>${formatMoneyValue(tx.total_amount)}</strong>
          <span class="tx-status ${getActivityStatusClass(tx)}">
            ${getActivityStatusLabel(tx)}
          </span>
        </div>
      </div>
    `;
      })
      .join("");
  } catch (err) {
    console.error("Error loading activity:", err);
  }
}

//  Load real user info into the account tab 
async function loadAccountTab() {
  const email = currentUserEmail;
  if (!email) return;

  try {
    const res = await fetch(`http://localhost:3000/api/cuenta?email=${email}`);
    const data = await res.json();
    if (!data.ok) return;

    const c = data.cuenta;
    applyCreditProfile(c);

    // Update name and initials avatar
    const initials = c.name.split(' ').map(p => p[0]).join('').substring(0, 2).toUpperCase();
    document.querySelector('.avatar').textContent = initials;
    document.querySelector('.profile-info h3').textContent = c.name;

    // Update credit available
    document.querySelector('.credit-available-card .balance-amount').textContent =
      '$' + parseFloat(c.available_balance).toLocaleString('es-MX', { minimumFractionDigits: 2 });

    // Update credit limit
    document.querySelector('.credit-limit-val').textContent =
      '$' + parseFloat(c.credit_limit).toLocaleString('es-MX', { minimumFractionDigits: 2 });

    // Update progress bar
    const usedPct = getCreditUsagePercent(c.used_balance, c.credit_limit);
    document.querySelector('#tab-account .progress-fill').style.width = usedPct + '%';

  } catch (err) {
    console.error('Error loading account tab:', err);
  }
}

// Detect current site and show its coupon on the hero card 
async function loadCurrentSiteCoupon() {
  const card = document.querySelector('.discount-card');
  if (card) card.dataset.siteCoupon = 'false';

  try {
    const domain = await resolveActivePageDomain();
    if (!domain) {
      setSitePromoState('unaffiliated');
      return;
    }

    const emailParam = currentUserEmail
      ? `&email=${encodeURIComponent(currentUserEmail)}`
      : '';

    const res = await fetch(`http://localhost:3000/api/merchants/check?domain=${domain}${emailParam}`);
    const data = await res.json();

    if (!data.affiliated) {
      setSitePromoState('unaffiliated');
      return;
    }

    const { merchant, coupon: code, discount } = data.merchant;

    setSitePromoState('affiliated');
    if (card) card.dataset.siteCoupon = 'true';
    document.querySelector('.discount-card .discount-amount').textContent = discount;
    document.querySelector('.discount-card .discount-desc').textContent =
      `Oferta exclusiva en ${data.merchant.name} con Kueski Pay.`;

    card.dataset.code = code;
    card.dataset.amount = discount;
    card.dataset.desc = `Válido en ${data.merchant.name}.`;
    card.dataset.expiry = data.merchant.expiresAt
      ? new Date(data.merchant.expiresAt).toLocaleDateString('es-MX')
      : '31 de Dic 2026';

  } catch (err) {
    console.error('Error loading site coupon:', err);
    setSitePromoState('unaffiliated');
  }
}

// ===== STORE URLS MAPPING =====
const storeUrls = {
  'amazon': 'https://www.amazon.com.mx',
  'liverpool': 'https://www.liverpool.com.mx',
  'privalia': 'https://www.privalia.com.mx',
  'nike': 'https://www.nike.com',
  'zara': 'https://www.zara.com',
  'att': 'https://www.att.com.mx',
  'office depot': 'https://www.officedepot.com.mx',
  'puma': 'https://www.puma.com',
  'adidas': 'https://www.adidas.com.mx',
  'shein': 'https://www.shein.com'
};

// ===== OPEN STORE IN NEW TAB =====
function openStore(storeName) {
  const url = storeUrls[storeName.toLowerCase()];
  if (url) {
    chrome.tabs.create({ url: url });
  }
}

// ===== COUPON DETAIL =====
function showCouponDetail(code, amount, desc, expiry) {
  if (!ensureFeatureAccess('purchases', 'Las compras con Kueski Pay están bloqueadas por pagos vencidos o crédito limitado.')) {
    return;
  }
  document.getElementById("cd-code").textContent = code;
  document.getElementById("cd-amount").textContent = amount;
  document.getElementById("cd-expiry").textContent =
    "📅 VÁLIDO HASTA EL " + expiry.toUpperCase();
  document.getElementById("coupon-overlay").classList.remove("hidden");
}

function closeCouponDetail() {
  document.getElementById("coupon-overlay").classList.add("hidden");
}

// ===== PAYMENT REMINDERS =====
function parseDueDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }

  const str = String(value);
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

function getReminderBadge(dueDate, isPaid) {
  if (isPaid) {
    return { status: 'paid', label: 'Pagado' };
  }

  const due = parseDueDate(dueDate);
  if (!due) {
    return { status: 'warning', label: 'Fecha pendiente' };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((due - today) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { status: 'danger', label: 'Vencido' };
  }
  if (diffDays === 0) {
    return { status: 'danger', label: 'Vence hoy' };
  }
  if (diffDays === 1) {
    return { status: 'danger', label: 'Vence mañana' };
  }
  return { status: 'warning', label: `Vence en ${diffDays} días` };
}

function formatReminderDate(dueDate) {
  const date = parseDueDate(dueDate);
  if (!date) return 'Fecha no disponible';
  return date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
}

async function loadReminders() {
  const list = document.getElementById('reminders-list');
  if (!list) return;

  if (!currentUserEmail) {
    list.innerHTML = '<p class="reminders-empty">Inicia sesión para ver tus recordatorios</p>';
    return;
  }

  list.innerHTML = '<p class="reminders-empty">Cargando recordatorios...</p>';

  try {
    const res = await fetch(
      `http://localhost:3000/api/recordatorios?email=${encodeURIComponent(currentUserEmail)}`
    );
    const data = await res.json();

    if (!data.ok) {
      list.innerHTML = '<p class="reminders-empty">No se pudieron cargar los recordatorios</p>';
      return;
    }

    if (!data.recordatorios || data.recordatorios.length === 0) {
      list.innerHTML =
        '<p class="reminders-empty">No tienes pagos próximos. Realiza una compra con Kueski Pay para ver recordatorios aquí.</p>';
      return;
    }

    list.innerHTML = data.recordatorios.map((item) => {
      const badge = getReminderBadge(item.due_date, false);
      const badgeClass =
        badge.status === 'danger' ? 'badge-danger' : 'badge-warning';
      const dateText = `Quincena ${item.installment_no} de ${item.num_installments} · Vence ${formatReminderDate(item.due_date)}`;
      const amount = parseFloat(item.amount);

      return `
        <div class="reminder-row">
          <div class="reminder-info">
            <strong>${escapeHtmlAttr(item.merchant)}</strong>
            <span class="reminder-amount">$${amount.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
            <span class="reminder-date">${dateText}</span>
          </div>
          <span class="reminder-badge ${badgeClass}">${badge.label}</span>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Error loading reminders:', err);
    list.innerHTML = '<p class="reminders-empty">No se pudo conectar al servidor</p>';
  }
}

function openReminders() {
  document.getElementById('reminders-overlay').classList.remove('hidden');
  loadReminders();
}

function closeReminders() {
  document.getElementById('reminders-overlay').classList.add('hidden');
}

function openDeleteAccount() {
  document.getElementById('delete-account-overlay').classList.remove('hidden');
}

function closeDeleteAccount() {
  document.getElementById('delete-account-overlay').classList.add('hidden');
}

async function confirmDeleteAccount() {
  if (!currentUserEmail) return;

  try {
    const res = await fetch('http://localhost:3000/api/cuenta', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: currentUserEmail }),
    });
    const data = await res.json();

    if (!data.ok) {
      alert(data.error || 'No se pudo eliminar la cuenta');
      return;
    }

    closeDeleteAccount();
    currentUserEmail = null;
    chrome.storage.local.remove('userEmail');
    updateRemindersIndicator();
    navigate('login');
  } catch (err) {
    console.error('Error deleting account:', err);
    alert('Error de conexión al eliminar la cuenta');
  }
}

async function payInstallment(installmentId) {
  if (!currentUserEmail || !installmentId) return;

  try {
    const res = await fetch('http://localhost:3000/api/recordatorios/pagar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: currentUserEmail,
        installment_id: parseInt(installmentId, 10),
      }),
    });
    const data = await res.json();

    if (!data.ok) {
      alert(data.error || 'No se pudo procesar el pago');
      return;
    }

    await loadReminders();
    await loadAccountData();
    await loadActivityData();
    updateRemindersIndicator();

    if (currentTransactionId) {
      await loadInstallmentTimeline(currentTransactionId);
    }

    if (data.pago?.transaction_completed) {
      alert(`¡Compra en ${data.pago.merchant} liquidada por completo!`);
    }
  } catch (err) {
    console.error('Error paying installment:', err);
    alert('Error de conexión al pagar la cuota');
  }
}

// ===== USER TRANSFERS =====
let visualTransferBalance = 4850;
let pendingTransfer = { recipient: '', amount: 0 };

function parseBalanceAmount(text) {
  return parseFloat(String(text).replace(/[$,\s]/g, '')) || 0;
}

function formatBalanceAmount(amount) {
  return '$' + amount.toLocaleString('es-MX', { minimumFractionDigits: 2 });
}

function resetTransferSteps() {
  document.getElementById('transfer-step-form').classList.remove('hidden');
  document.getElementById('transfer-step-confirm').classList.add('hidden');
  document.getElementById('transfer-step-success').classList.add('hidden');
  document.getElementById('transfer-recipient').value = '';
  document.getElementById('transfer-amount').value = '';
}

function openTransfer() {
  if (!ensureFeatureAccess('transfers', 'Las transferencias no están disponibles con tu estatus de crédito actual.')) {
    return;
  }
  resetTransferSteps();
  document.getElementById('transfer-overlay').classList.remove('hidden');
  refreshTransferBalance();
}

async function refreshTransferBalance() {
  const display = document.getElementById('transfer-balance-display');
  if (!currentUserEmail) {
    display.textContent = 'Saldo disponible: $0.00';
    visualTransferBalance = 0;
    return;
  }

  display.textContent = 'Saldo disponible: cargando...';

  try {
    const res = await fetch(
      `http://localhost:3000/api/cuenta?email=${encodeURIComponent(currentUserEmail)}`
    );
    const data = await res.json();

    if (!data.ok) {
      display.textContent = 'Saldo disponible: no disponible';
      return;
    }

    visualTransferBalance = parseFloat(data.cuenta.available_balance);
    display.textContent = 'Saldo disponible: ' + formatBalanceAmount(visualTransferBalance);
  } catch (err) {
    console.error('Error loading transfer balance:', err);
    display.textContent = 'Saldo disponible: no disponible';
  }
}

function closeTransfer() {
  document.getElementById('transfer-overlay').classList.add('hidden');
  resetTransferSteps();
}

function submitTransfer() {
  const recipient = document.getElementById('transfer-recipient').value.trim();
  const amount = parseFloat(document.getElementById('transfer-amount').value);

  if (!recipient) {
    alert('Ingresa el email o nombre del destinatario');
    return;
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    alert('Ingresa un monto válido');
    return;
  }

  if (amount > visualTransferBalance) {
    alert('El monto supera tu saldo disponible');
    return;
  }

  pendingTransfer = { recipient, amount };
  document.getElementById('transfer-confirm-text').textContent =
    `¿Enviar ${formatBalanceAmount(amount)} a ${recipient}?`;

  document.getElementById('transfer-step-form').classList.add('hidden');
  document.getElementById('transfer-step-confirm').classList.remove('hidden');
}

function cancelTransfer() {
  document.getElementById('transfer-step-confirm').classList.add('hidden');
  document.getElementById('transfer-step-form').classList.remove('hidden');
}

async function confirmTransfer() {
  if (!currentUserEmail) {
    alert('Inicia sesión primero');
    return;
  }

  const confirmBtn = document.querySelector('[data-action="transfer-confirm"]');
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Procesando...';
  }

  try {
    const res = await fetch('http://localhost:3000/api/transferencias', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from_email: currentUserEmail,
        to: pendingTransfer.recipient,
        amount: pendingTransfer.amount
      })
    });

    const data = await res.json();

    if (!data.ok) {
      alert(data.error || 'No se pudo completar la transferencia');
      return;
    }

    await loadAccountData();
    await loadAccountTab();
    await loadActivityData();

    document.getElementById('transfer-step-confirm').classList.add('hidden');
    document.getElementById('transfer-step-success').classList.remove('hidden');
  } catch (err) {
    console.error('Transfer error:', err);
    alert('No se pudo conectar al servidor');
  } finally {
    if (confirmBtn) {
      confirmBtn.disabled = false;
      confirmBtn.textContent = 'Confirmar';
    }
  }
}

// ===== COPY COUPON CODE =====
function copyCode() {
  const code = document.getElementById("cd-code").textContent;
  navigator.clipboard.writeText(code).then(() => {
    const btn = document.querySelector(".btn-copy");
    btn.textContent = "¡Copiado!";
    setTimeout(() => {
      btn.textContent = "Copiar";
    }, 1500);
  });
}

// ===== STORE SEARCH FILTER =====
function filterStores() {
  renderStoresList();
}

async function requestDemoLoan() {
  if (!currentUserEmail) {
    alert("Inicia sesión primero");
    return;
  }
  if (!ensureFeatureAccess('kueski_cash', 'Kueski Cash no está disponible con tu estatus de crédito actual.')) {
    return;
  }

  const rawAmount = prompt("¿Cuánto dinero quieres agregar al saldo?");
  if (rawAmount === null) return;

  const amount = Number(rawAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    alert("Ingresa una cantidad válida");
    return;
  }

  try {
    const res = await fetch('http://localhost:3000/api/prestamo-demo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: currentUserEmail, amount })
    });

    const data = await res.json();

    if (!data.ok) {
      alert(data.error || 'No se pudo agregar el saldo');
      return;
    }

    alert(`Listo. Se agregaron $${amount.toLocaleString('es-MX', { minimumFractionDigits: 2 })} al saldo.`);
    loadAccountData();
    loadActivityData();
    loadAccountTab();
  } catch (err) {
    console.error('Demo loan error:', err);
    alert('No se pudo conectar al servidor.');
  }
}

// ===== CATEGORY CHIP TOGGLE =====
document.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("click", (e) => {
    const actionEl = e.target.closest("[data-action]");
    if (!actionEl) return;

    const action = actionEl.dataset.action;

    if (actionEl.tagName === "A") {
      e.preventDefault();
    }

    switch (action) {
      case "navigate":
        if (actionEl.dataset.view === "onboarding") {
          // Register form — save to DB before proceeding
          const name = document
            .querySelector('#view-register input[type="text"]')
            .value.trim();
          const email = document
            .querySelector('#view-register input[type="email"]')
            .value.trim();
          if (!name || !email) {
            alert("Completa todos los campos");
            return;
          }
          registerUser(name, email);
        } else if (actionEl.dataset.view === "home") {
          // Login — validate user exists in DB
          const email = document.getElementById("login-email").value.trim();
          if (!email) {
            alert("Ingresa tu correo electrónico");
            return;
          }
          loginUser(email);
        } else {
          navigate(actionEl.dataset.view);
        }
        break;
      case "switch-tab":
        switchTab(actionEl.dataset.tab);
        break;
      case "toggle-card-cvv":
        toggleCardCvv();
        break;
      case "copy-card-number":
        copyCardNumber();
        break;
        case 'coupon-detail':
          // Hero card on affiliated site opens checkout flow
          // Mini coupons open the regular coupon detail overlay
          if (actionEl.closest('.discount-card')) {
            openCheckout();
          } else {
            showCouponDetail(
              actionEl.dataset.code,
              actionEl.dataset.amount,
              actionEl.dataset.desc,
              actionEl.dataset.expiry
            );
          }
          break;
      case "close-coupon-detail":
        closeCouponDetail();
        break;
      case "open-reminders":
        openReminders();
        break;
      case "close-reminders":
        closeReminders();
        break;
      case "pay-installment-timeline":
        payInstallment(actionEl.dataset.installmentId);
        break;
      case "open-transfer":
        openTransfer();
        break;
      case "close-transfer":
        closeTransfer();
        break;
      case "transfer-submit":
        submitTransfer();
        break;
      case "transfer-confirm":
        confirmTransfer();
        break;
      case "transfer-cancel":
        cancelTransfer();
        break;
      case "copy-code":
        copyCode();
        break;
      case "transaction-detail":
        showTransactionDetail(actionEl);
        break;
      case "close-transaction-detail":
        closeTransactionDetail();
        break;

      // Clear session and return to login
      case 'logout':
        currentUserEmail = null;
        chrome.storage.local.remove('userEmail');
        updateRemindersIndicator();
        navigate('login');
        break;
      case 'open-delete-account':
        openDeleteAccount();
        break;
      case 'close-delete-account':
        closeDeleteAccount();
        break;
      case 'confirm-delete-account':
        confirmDeleteAccount();
        break;

      // Hide checkout overlay and refresh balance
      case 'close-checkout':
        document.getElementById('checkout-overlay').classList.add('hidden');
        loadAccountData();
        break;

      // Move to plan selection step
      case 'checkout-next':
        checkoutNext();
        break;

      // Go back to amount entry step
      case 'checkout-back':
        document.getElementById('checkout-step-2').style.display = 'none';
        document.getElementById('checkout-step-1').style.display = 'block';
        break;

      // Confirm payment and save to DB
      case 'checkout-confirm':
        checkoutConfirm();
        break;

      case 'demo-loan':
        requestDemoLoan();
        break;
              
      default:
        break;
    }
  });

  const storeSearch = document.getElementById("store-search");
  if (storeSearch) {
    storeSearch.addEventListener("input", filterStores);
  }

  document.querySelectorAll(".cat-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document
        .querySelectorAll(".cat-chip")
        .forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      activeStoreCategory = chip.textContent.trim();
      renderStoresList();
    });
  });
});

// Validate user exists in DB before letting them in
async function loginUser(email) {
  try {
    const res = await fetch(`http://localhost:3000/api/cuenta?email=${email}`);
    const data = await res.json();

    if (!data.ok) {
      alert("Usuario no encontrado. Prueba bueno@demo.com, regular@demo.com o limitado@demo.com");
      return;
    }

    // Save logged in user and go to home
    currentUserEmail = email;
    chrome.storage.local.set({ userEmail: email }); // Persist session
    navigate("home");
  } catch (err) {
    console.error("Login error:", err);
    alert("No se pudo conectar al servidor.");
  }
}

//  Register new user in DB then go to onboarding 
async function registerUser(name, email) {
  try {
    const res = await fetch('http://localhost:3000/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email })
    });
    const data = await res.json();

    if (!data.ok) {
      alert(data.error || 'Error al registrar usuario');
      return;
    }

    // Success — go to onboarding
    currentUserEmail = email;
    chrome.storage.local.set({ userEmail: email }); // Persist session
    navigate('onboarding');

  } catch (err) {
    console.error('Register error:', err);
    alert('No se pudo conectar al servidor.');
  }
}

// Tracks current checkout session data
let checkoutState = { domain: '', merchantName: '', couponCode: '', planId: null };

//  Open Kueski Pay Checkout Step 1
async function openCheckout() {
  if (!ensureFeatureAccess('purchases', 'Las compras con Kueski Pay están bloqueadas por pagos vencidos o crédito limitado.')) {
    return;
  }
  try {
    const domain = await resolveActivePageDomain();
    if (!domain) return;

    const emailParam = currentUserEmail
      ? `&email=${encodeURIComponent(currentUserEmail)}`
      : '';
    const res = await fetch(`http://localhost:3000/api/merchants/check?domain=${domain}${emailParam}`);
    const data = await res.json();

    if (!data.affiliated) return;

    // Save for use when confirming transaction
    checkoutState.domain = domain;
    checkoutState.merchantName = data.merchant.name;
    checkoutState.couponCode = data.merchant.coupon;

    document.getElementById('checkout-merchant').textContent = data.merchant.name;
    document.getElementById('checkout-coupon-info').style.display = 'block';
    document.getElementById('checkout-coupon-code').textContent = data.merchant.coupon;
    document.getElementById('checkout-coupon-discount').textContent = data.merchant.discount;

    // Reset to step 1 in case user opened it before
    document.getElementById('checkout-step-1').style.display = 'block';
    document.getElementById('checkout-step-2').style.display = 'none';
    document.getElementById('checkout-step-3').style.display = 'none';
    document.getElementById('checkout-amount').value = '';

    document.getElementById('checkout-overlay').classList.remove('hidden');
  } catch (err) {
    console.error('Error opening checkout:', err);
  }
}

// Checkout Step 2 : Show Payment Plans
async function checkoutNext() {
  const amount = parseFloat(document.getElementById('checkout-amount').value);
  if (!amount || amount <= 0) {
    alert('Ingresa un monto válido');
    return;
  }

  // Fetch plans and validate coupon from API
  const planesRes = await fetch('http://localhost:3000/api/planes');
  const planesData = await planesRes.json();

  const emailParam = currentUserEmail
    ? `&email=${encodeURIComponent(currentUserEmail)}`
    : '';
  const couponRes = await fetch(
    `http://localhost:3000/api/cupones/check?codigo=${checkoutState.couponCode}&domain=${checkoutState.domain}${emailParam}`
  );
  const couponData = await couponRes.json();

  // Calculate discount — handles both % and fixed amount coupons
  let discount = 0;
  if (couponData.valido) {
    discount = parseDiscountFromLabel(couponData.cupon.discount, amount);
  }

  const total = amount - discount;

  document.getElementById('checkout-total').textContent =
    '$' + total.toLocaleString('es-MX', { minimumFractionDigits: 2 });
  document.getElementById('checkout-savings').textContent =
    discount > 0 ? '🎉 Ahorraste $' + discount.toLocaleString('es-MX', { minimumFractionDigits: 2 }) : '';

  // Build plan cards showing per-quincena amount
  const plansDiv = document.getElementById('plan-options');
  plansDiv.innerHTML = planesData.planes.map(plan => {
    const planTotal = total * (1 + parseFloat(plan.interest_rate));
    const perInst = planTotal / plan.num_installments;
    return `
      <div class="plan-option" data-plan-id="${plan.id}"
           style="border:2px solid #e0e0e0;border-radius:12px;padding:12px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center">
        <div>
          <p style="font-weight:700;margin:0">${plan.name}</p>
          <p style="font-size:12px;color:#666;margin:2px 0 0">${plan.interest_rate > 0 ? parseFloat((plan.interest_rate * 100).toFixed(2)) + '% interés' : 'Sin interés'}</p>
        </div>
        <div style="text-align:right">
          <p style="font-weight:800;color:#1a1a2e;margin:0">$${parseFloat(perInst.toFixed(2)).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</p>
          <p style="font-size:11px;color:#666;margin:0">por quincena</p>
        </div>
      </div>`;
  }).join('');

  // Let user click a plan to select it
  plansDiv.querySelectorAll('.plan-option').forEach(el => {
    el.addEventListener('click', () => {
      plansDiv.querySelectorAll('.plan-option').forEach(p => p.style.border = '2px solid #e0e0e0');
      el.style.border = '2px solid #0a7a4b';
      checkoutState.planId = parseInt(el.dataset.planId);
    });
  });

  // Auto-select first plan by default
  if (planesData.planes.length > 0) {
    plansDiv.querySelector('.plan-option').style.border = '2px solid #0a7a4b';
    checkoutState.planId = planesData.planes[0].id;
  }

  document.getElementById('checkout-step-1').style.display = 'none';
  document.getElementById('checkout-step-2').style.display = 'block';
}

// Checkout step 3 : Confirm and save to DB 
async function checkoutConfirm() {
  if (!checkoutState.planId) {
    alert('Selecciona un plan de pago');
    return;
  }

  const amount = parseFloat(document.getElementById('checkout-amount').value);

  try {
    // Send transaction to backend : saves to DB and updates balance
    const res = await fetch('http://localhost:3000/api/transacciones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: currentUserEmail,
        plan_id: checkoutState.planId,
        monto: amount,
        domain: checkoutState.domain,
        coupon_code: checkoutState.couponCode
      })
    });
    const data = await res.json();

    if (!data.ok) {
      alert(data.error || 'Error al procesar el pago');
      return;
    }

    // Show success screen with payment summary
    const tx = data.transaccion;
    document.getElementById('checkout-success-msg').textContent =
      `$${parseFloat(tx.total_amount).toLocaleString('es-MX', { minimumFractionDigits: 2 })} en ${tx.num_installments} quincenas de $${parseFloat(tx.amount_per_installment).toLocaleString('es-MX', { minimumFractionDigits: 2 })} cada una.`;

    document.getElementById('checkout-step-2').style.display = 'none';
    document.getElementById('checkout-step-3').style.display = 'block';

  } catch (err) {
    alert('Error de conexión');
    console.error(err);
  }
}

// ===== CLOSE OVERLAY ON BACKDROP CLICK =====
document.addEventListener("click", (e) => {
  const couponOverlay = document.getElementById("coupon-overlay");
  if (e.target === couponOverlay) closeCouponDetail();

  const remindersOverlay = document.getElementById("reminders-overlay");
  if (e.target === remindersOverlay) closeReminders();

  const transferOverlay = document.getElementById("transfer-overlay");
  if (e.target === transferOverlay) closeTransfer();

  const transactionOverlay = document.getElementById("transaction-overlay");
  if (e.target === transactionOverlay) closeTransactionDetail();

  const deleteAccountOverlay = document.getElementById("delete-account-overlay");
  if (e.target === deleteAccountOverlay) closeDeleteAccount();
});
