// ===== VIEW NAVIGATION =====
function navigate(viewName) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  
  if (['home', 'stores', 'activity', 'account'].includes(viewName)) {
    document.getElementById('view-app').classList.add('active');
    switchTab(viewName);
  } else {
    const view = document.getElementById('view-' + viewName);
    if (view) view.classList.add('active');
  }
}

// ===== TAB SWITCHING =====
function switchTab(tabName) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  
  const tab = document.getElementById('tab-' + tabName);
  if (tab) tab.classList.add('active');
  
  const navItems = document.querySelectorAll('.nav-item');
  const tabOrder = ['home', 'stores', 'activity', 'account'];
  const idx = tabOrder.indexOf(tabName);
  if (idx >= 0 && navItems[idx]) navItems[idx].classList.add('active');

  // Scroll to top
  document.getElementById('app-content').scrollTop = 0;
}

// ===== COUPON DETAIL =====
function showCouponDetail(code, amount, desc, expiry) {
  document.getElementById('cd-code').textContent = code;
  document.getElementById('cd-amount').textContent = amount;
  document.getElementById('cd-expiry').textContent = '📅 VÁLIDO HASTA EL ' + expiry.toUpperCase();
  document.getElementById('coupon-overlay').classList.remove('hidden');
}

function closeCouponDetail() {
  document.getElementById('coupon-overlay').classList.add('hidden');
}

// ===== COPY COUPON CODE =====
function copyCode() {
  const code = document.getElementById('cd-code').textContent;
  navigator.clipboard.writeText(code).then(() => {
    const btn = document.querySelector('.btn-copy');
    btn.textContent = '¡Copiado!';
    setTimeout(() => { btn.textContent = 'Copiar'; }, 1500);
  });
}

// ===== STORE SEARCH FILTER =====
function filterStores() {
  const query = document.getElementById('store-search').value.toLowerCase();
  document.querySelectorAll('.store-row').forEach(row => {
    const name = row.getAttribute('data-name');
    row.style.display = name.includes(query) ? 'flex' : 'none';
  });
}

// ===== CATEGORY CHIP TOGGLE =====
document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('click', (e) => {
    const actionEl = e.target.closest('[data-action]');
    if (!actionEl) return;

    const action = actionEl.dataset.action;

    if (actionEl.tagName === 'A') {
      e.preventDefault();
    }

    switch (action) {
      case 'navigate':
        navigate(actionEl.dataset.view);
        break;
      case 'switch-tab':
        switchTab(actionEl.dataset.tab);
        break;
      case 'coupon-detail':
        showCouponDetail(
          actionEl.dataset.code,
          actionEl.dataset.amount,
          actionEl.dataset.desc,
          actionEl.dataset.expiry
        );
        break;
      case 'close-coupon-detail':
        closeCouponDetail();
        break;
      case 'copy-code':
        copyCode();
        break;
      default:
        break;
    }
  });

  const storeSearch = document.getElementById('store-search');
  if (storeSearch) {
    storeSearch.addEventListener('input', filterStores);
  }

  document.querySelectorAll('.cat-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.cat-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    });
  });
});

// ===== CLOSE OVERLAY ON BACKDROP CLICK =====
document.addEventListener('click', (e) => {
  const overlay = document.getElementById('coupon-overlay');
  if (e.target === overlay) closeCouponDetail();
});
