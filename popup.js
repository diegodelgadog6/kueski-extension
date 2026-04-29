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
      case "coupon-detail":
        showCouponDetail(
          actionEl.dataset.code,
          actionEl.dataset.amount,
          actionEl.dataset.desc,
          actionEl.dataset.expiry
        );
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

// ===== CLOSE OVERLAY ON BACKDROP CLICK =====
document.addEventListener("click", (e) => {
  const overlay = document.getElementById("coupon-overlay");
  if (e.target === overlay) closeCouponDetail();
});
