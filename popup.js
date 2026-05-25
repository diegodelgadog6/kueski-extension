// Track the currently logged-in user
let currentUserEmail = null;

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

  if (["home", "stores", "activity", "account"].includes(viewName)) {
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
  const tabOrder = ["home", "stores", "activity", "account"];
  const idx = tabOrder.indexOf(tabName);
  if (idx >= 0 && navItems[idx]) navItems[idx].classList.add("active");

  // Scroll to top
  document.getElementById("app-content").scrollTop = 0;

  // Load real data when switching tabs from the DB
  if (tabName === "activity") loadActivityData();
  if (tabName === "account") loadAccountTab();
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

    // Update balance (Home tab)
    const homeBalance = document.querySelector('#tab-home .balance-amount');
    if (homeBalance) {
      homeBalance.textContent =
        '$' +
        parseFloat(c.available_balance).toLocaleString('es-MX', {
          minimumFractionDigits: 2,
        });
    }

    // Update credit card bar
    const usedPct = parseFloat(c.credit_limit) > 0
  ? Math.round((parseFloat(c.used_balance) / parseFloat(c.credit_limit)) * 100)
  : 0;
    document.querySelector(".credit-pct").textContent = usedPct + "%";
    document.querySelector(".progress-fill").style.width = usedPct + "%";
    document.querySelector(".credit-range span:first-child").textContent =
      "$" + parseFloat(c.used_balance).toLocaleString("es-MX") + " Usado";
    document.querySelector(".credit-range span:last-child").textContent =
      "$" + parseFloat(c.credit_limit).toLocaleString("es-MX") + " Límite";

    // Update account tab
    document.querySelector(
      ".balance-amount + .progress-bar + div strong, .credit-limit-val"
    ).textContent =
      "$" +
      parseFloat(c.credit_limit).toLocaleString("es-MX", {
        minimumFractionDigits: 2,
      });
  } catch (err) {
    console.error("Error loading account data:", err);
  }

  loadCurrentSiteCoupon();

}

// Fetch account + transactions from the backend for this user
function getActivityStatusLabel(tx) {
  if (tx.status === 'transfer_sent') return 'ENVIADA';
  if (tx.status === 'transfer_received') return 'RECIBIDA';
  if (getActivityKind(tx) === 'loan') return 'ACREDITADO';
  if (tx.status === 'authorized') return tx.num_installments + ' QUINCENAS';
  if (tx.status === 'completed') return 'PAGADO';
  return String(tx.status || '').toUpperCase();
}

function getActivityStatusClass(tx) {
  if (tx.status === 'transfer_received') return 'paid';
  if (getActivityKind(tx) === 'loan') return 'paid';
  if (tx.status === 'transfer_sent') return 'pending';
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
  if (getActivityKind(tx) === 'loan') return 'Préstamo';
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
  if (tx.status === 'completed') return 'PAGADO';
  if (tx.status === 'transfer_received') return 'RECIBIDA';
  if (tx.status === 'transfer_sent') return 'ENVIADA';
  if (getActivityKind(tx) === 'loan') return 'ACREDITADO';
  if (tx.status === 'authorized') return 'PENDIENTE';
  return getActivityStatusLabel(tx);
}

function getTransactionCouponLabel(tx) {
  return tx.coupon_label || 'Ninguno';
}

function getTransactionInstallmentsLabel(tx) {
  if (getActivityKind(tx) !== 'purchase') return '';
  return `${tx.num_installments || 0} quincenas`;
}

function getActivityKind(tx) {
  if (tx.status === 'transfer_sent' || tx.status === 'transfer_received') return 'transfer';
  if (tx.status === 'loaned' || tx.merchant === 'Préstamo demo') return 'loan';
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
  if (kind === 'loan') return 'Préstamo Kueski Cash';
  return tx.merchant || 'Kueski Pay';
}

function getActivityKindLabel(kind) {
  if (kind === 'transfer') return 'Transferencia';
  if (kind === 'loan') return 'Préstamo';
  return 'Compra';
}

function setTransactionDetailBadge(status) {
  const badge = document.getElementById('txd-status-badge');
  badge.textContent = status || 'PENDIENTE';
  const isPaid = ['PAGADO', 'RECIBIDA', 'ACREDITADO'].includes(status);
  badge.className = 'tx-detail-badge ' + (isPaid ? 'paid' : 'pending');
}

function showTransactionDetail(row) {
  const d = row.dataset;
  const kind = d.type || 'purchase';

  document.getElementById('txd-kind').textContent = getActivityKindLabel(kind);
  document.getElementById('txd-store').textContent = d.store || 'Kueski Pay';
  document.getElementById('txd-date').textContent = d.date || '';
  setTransactionDetailBadge(d.status);

  document.getElementById('txd-purchase-details').classList.add('hidden');
  document.getElementById('txd-transfer-details').classList.add('hidden');
  document.getElementById('txd-loan-details').classList.add('hidden');

  if (kind === 'purchase') {
    document.getElementById('txd-original').textContent = d.original || d.amount || '$0.00';
    document.getElementById('txd-coupon').textContent = d.coupon || 'Ninguno';
    document.getElementById('txd-savings').textContent = d.savings || '$0.00';
    document.getElementById('txd-amount').textContent = d.amount || '$0.00';
    document.getElementById('txd-installments').textContent = d.installments || '—';
    document.getElementById('txd-installment-amount').textContent = d.installmentAmount || '$0.00';
    document.getElementById('txd-method').textContent = d.method || 'Kueski Pay - Crédito';
    document.getElementById('txd-purchase-details').classList.remove('hidden');
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
    const usedPct = c.credit_limit > 0
      ? Math.round((parseFloat(c.used_balance) / parseFloat(c.credit_limit)) * 100)
      : 0;
    document.querySelector('#tab-account .progress-fill').style.width = usedPct + '%';

  } catch (err) {
    console.error('Error loading account tab:', err);
  }
}

// Detect current site and show its coupon on the hero card 
async function loadCurrentSiteCoupon() {
  try {
    // Get the active tab's URL
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;

    const domain = new URL(tab.url).hostname.replace('www.', '');

    // Check if this merchant has a coupon in the DB
    const res = await fetch(`http://localhost:3000/api/merchants/check?domain=${domain}`);
    const data = await res.json();

    if (!data.affiliated) return;

    const { merchant, coupon: code, discount } = data.merchant;

    // Update the hero card with real data
    document.querySelector('.discount-card .discount-amount').textContent = discount;
    document.querySelector('.discount-card .discount-desc').textContent =
      `Oferta exclusiva en ${data.merchant.name} con Kueski Pay.`;

    // Make "Aplicar ahora" open the coupon detail for this store
    const card = document.querySelector('.discount-card');
    card.dataset.code = code;
    card.dataset.amount = discount;
    card.dataset.desc = `Válido en ${data.merchant.name}.`;
    card.dataset.expiry = data.merchant.expiresAt
      ? new Date(data.merchant.expiresAt).toLocaleDateString('es-MX')
      : '31 de Dic 2026';

  } catch (err) {
    console.error('Error loading site coupon:', err);
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
      const isPaid = item.status === 'paid' || item.paid_at != null;
      const badge = getReminderBadge(item.due_date, isPaid);
      const badgeClass =
        badge.status === 'paid' ? 'badge-paid' : badge.status === 'danger' ? 'badge-danger' : 'badge-warning';
      const dateText = isPaid ? 'Pagado' : `Vence ${formatReminderDate(item.due_date)}`;
      const amount = parseFloat(item.amount);

      return `
        <div class="reminder-row">
          <div class="reminder-info">
            <strong>${item.merchant}</strong>
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
  const query = document.getElementById("store-search").value.toLowerCase();
  document.querySelectorAll(".store-row").forEach((row) => {
    const name = row.getAttribute("data-name");
    row.style.display = name.includes(query) ? "flex" : "none";
  });
}

async function requestDemoLoan() {
  if (!currentUserEmail) {
    alert("Inicia sesión primero");
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
        navigate('login');
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
    });
  });
  // Add clickable behavior for store rows
  document.querySelectorAll(".store-row").forEach((row) => {
    row.style.cursor = "pointer";
    row.addEventListener("click", (e) => {
      e.stopPropagation();
      const storeName = row.getAttribute("data-name");
      openStore(storeName);
    });
  });

  // Add clickable behavior for store chips (featured stores)
  document.querySelectorAll(".store-chip").forEach((chip) => {
    const span = chip.querySelector("span");
    const storeName = span ? span.textContent.toLowerCase() : null;
    chip.style.cursor = "pointer";
    chip.addEventListener("click", (e) => {
      // Prevent global delegation from also handling this click
      e.stopPropagation();
      if (storeName) openStore(storeName);
    });
  });
});

// Validate user exists in DB before letting them in
async function loginUser(email) {
  try {
    const res = await fetch(`http://localhost:3000/api/cuenta?email=${email}`);
    const data = await res.json();

    if (!data.ok) {
      alert("Usuario no encontrado. Usa ana.garcia@demo.com para la demo.");
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
  try {
    // Get domain of current site
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const domain = new URL(tab.url).hostname.replace('www.', '');

    const res = await fetch(`http://localhost:3000/api/merchants/check?domain=${domain}`);
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

  const couponRes = await fetch(`http://localhost:3000/api/cupones/check?codigo=${checkoutState.couponCode}&domain=${checkoutState.domain}`);
  const couponData = await couponRes.json();

  // Calculate discount — handles both % and fixed amount coupons
  let discount = 0;
  if (couponData.valido) {
    const pct = couponData.cupon.discount.match(/(\d+(\.\d+)?)\s*%/);
    const fixed = couponData.cupon.discount.match(/\$\s*(\d+(\.\d+)?)/);
    if (pct) discount = amount * (parseFloat(pct[1]) / 100);
    if (fixed) discount = parseFloat(fixed[1]);
    discount = Math.min(discount, amount);
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
});
