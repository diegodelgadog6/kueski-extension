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
        chrome.runtime.sendMessage({
          type: 'LOG_ACTIVITY',
          domain: currentDomain,
          action: 'viewed_coupon',
          details: `Banner mostrado para ${response.merchant.name}`
        });
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
        <img src="${chrome.runtime.getURL('assets/kueski-logo.webp')}" style="width:24px;height:24px;object-fit:contain;border-radius:4px" alt="Kueski">
        <div class="kueski-banner-text">
          <strong>¡${merchant.name} acepta Kueski Pay!</strong>
          <span>Cupón disponible: ${merchant.discount} con código <b>${merchant.coupon}</b></span>
        </div>
        <button class="kueski-banner-btn" id="kueski-copy-btn">Pagar con Kueski Pay</button>
        <button class="kueski-banner-close" id="kueski-close-btn">✕</button>
      </div>
    `;
    
    document.body.appendChild(banner);

    // Animate in
    requestAnimationFrame(() => {
      banner.classList.add('kueski-banner-show');
    });

    // Prompt user to open the widget to pay with Kueski Pay
    document.getElementById('kueski-copy-btn').addEventListener('click', () => {
      // Flash the extension badge to guide user to open the popup
      chrome.runtime.sendMessage({ type: 'HIGHLIGHT_ICON' });
      chrome.runtime.sendMessage({
        type: 'LOG_ACTIVITY',
        domain: currentDomain,
        action: 'opened_widget',
        details: `Pago iniciado en ${merchant.name}`
      });
      // Update banner to guide user
      const logoUrl = chrome.runtime.getURL('assets/icon48.png');
      document.querySelector('.kueski-banner-text span').innerHTML = `Haz clic en el ícono <img src="${logoUrl}" style="width:16px;height:16px;object-fit:contain;vertical-align:middle;border-radius:3px"> en tu barra de herramientas`;
      document.getElementById('kueski-copy-btn').textContent = '✓ Listo';
      document.getElementById('kueski-copy-btn').disabled = true;
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
