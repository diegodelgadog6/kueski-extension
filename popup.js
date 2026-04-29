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

    // Update balance
    document.querySelector(".balance-amount").textContent =
      "$" +
      parseFloat(c.available_balance).toLocaleString("es-MX", {
        minimumFractionDigits: 2,
      });

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
async function loadActivityData() {
  const email = currentUserEmail;
  if (!email) return;

  try {
    const res = await fetch(`http://localhost:3000/api/cuenta?email=${email}`);
    const data = await res.json();
    if (!data.ok) return;

    const txs = data.ultimas_transacciones;
    const list = document.querySelector(".transactions-list");

    // Calculate real totals from DB transactions
    const totalSpent = txs.reduce((sum, tx) => sum + parseFloat(tx.total_amount), 0);
    const totalSaved = txs.reduce((sum, tx) => sum + parseFloat(tx.discount_amount || 0), 0);

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
      .map(
        (tx) => `
      <div class="transaction-row">
        <div class="tx-icon">🛒</div>
        <div class="tx-info">
          <strong>${tx.merchant || "Kueski Pay"}</strong>
          <span>${new Date(tx.created_at).toLocaleDateString(
            "es-MX"
          )} • Crédito</span>
        </div>
        <div class="tx-amount">
          <strong>$${parseFloat(tx.total_amount).toLocaleString("es-MX", {
            minimumFractionDigits: 2,
          })}</strong>
          <span class="tx-status ${
            tx.status === "completed" ? "paid" : "pending"
          }">
            ${
              tx.status === "authorized"
                ? tx.num_installments + " QUINCENAS"
                : tx.status.toUpperCase()
            }
          </span>
        </div>
      </div>
    `
      )
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
      case "copy-code":
        copyCode();
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
  const overlay = document.getElementById("coupon-overlay");
  if (e.target === overlay) closeCouponDetail();
});
