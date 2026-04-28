// ===== KUESKI SMART WIDGET - CONTENT SCRIPT =====
// This script runs on every page the user visits

(function() {
  const currentDomain = window.location.hostname;
  
  // Ask background script if this is an affiliated merchant
  chrome.runtime.sendMessage(
    { type: 'CHECK_MERCHANT', domain: currentDomain },
    (response) => {
      if (response && response.affiliated) {
        showKueskiBanner(response.merchant);
      }
    }
  );

  function showKueskiBanner(merchant) {
    // Don't show if already shown
    if (document.getElementById('kueski-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'kueski-banner';
    banner.innerHTML = `
      <div class="kueski-banner-content">
        <span class="kueski-banner-logo">🌱</span>
        <div class="kueski-banner-text">
          <strong>¡${merchant.name} acepta Kueski Pay!</strong>
          <span>Cupón disponible: ${merchant.discount} con código <b>${merchant.coupon}</b></span>
        </div>
        <button class="kueski-banner-btn" id="kueski-copy-btn">Copiar código</button>
        <button class="kueski-banner-close" id="kueski-close-btn">✕</button>
      </div>
    `;
    
    document.body.appendChild(banner);

    // Animate in
    requestAnimationFrame(() => {
      banner.classList.add('kueski-banner-show');
    });

    // Copy button
    document.getElementById('kueski-copy-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(merchant.coupon);
      document.getElementById('kueski-copy-btn').textContent = '¡Copiado!';
      setTimeout(() => {
        document.getElementById('kueski-copy-btn').textContent = 'Copiar código';
      }, 2000);
    });

    // Close button
    document.getElementById('kueski-close-btn').addEventListener('click', () => {
      banner.classList.remove('kueski-banner-show');
      setTimeout(() => banner.remove(), 300);
    });

    // Auto-hide after 10 seconds
    setTimeout(() => {
      if (document.getElementById('kueski-banner')) {
        banner.classList.remove('kueski-banner-show');
        setTimeout(() => banner.remove(), 300);
      }
    }, 10000);
  }
})();
