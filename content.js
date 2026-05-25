// ===== KUESKI SMART WIDGET - CONTENT SCRIPT =====
// This script runs on every page the user visits

(function() {
  const currentDomain = window.location.hostname;

  chrome.runtime.sendMessage(
    { type: 'CHECK_MERCHANT', domain: currentDomain },
    (response) => {
      if (response && response.affiliated) {
        showKueskiBanner(response.merchant);
        chrome.runtime.sendMessage({
          type: 'LOG_ACTIVITY',
          domain: currentDomain,
          action: 'viewed_payment_promo',
          details: `Banner mostrado para ${response.merchant.name}`
        });
      }
    }
  );

  function showKueskiBanner(merchant) {
    if (document.getElementById('kueski-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'kueski-banner';
    banner.innerHTML = `
      <div class="kueski-banner-content">
        <img src="${chrome.runtime.getURL('assets/kueski-logo.webp')}" style="width:24px;height:24px;object-fit:contain;border-radius:4px" alt="Kueski">
        <div class="kueski-banner-text">
          <strong>¡Puedes pagar con Kueski Pay en ${merchant.name}!</strong>
          <span>Compra ahora y paga en quincenas, sin tarjeta de crédito</span>
        </div>
        <button class="kueski-banner-btn" id="kueski-pay-btn">Pagar con Kueski Pay</button>
        <button class="kueski-banner-close" id="kueski-close-btn">✕</button>
      </div>
    `;

    document.body.appendChild(banner);

    requestAnimationFrame(() => {
      banner.classList.add('kueski-banner-show');
    });

    document.getElementById('kueski-pay-btn').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }, (response) => {
        if (response && response.ok) {
          return;
        }

        chrome.runtime.sendMessage({ type: 'HIGHLIGHT_ICON' });
        chrome.runtime.sendMessage({
          type: 'LOG_ACTIVITY',
          domain: currentDomain,
          action: 'opened_widget',
          details: `Pago iniciado en ${merchant.name}`
        });

        document.querySelector('.kueski-banner-text span').textContent =
          'Abre la extensión de Kueski en tu toolbar para ver cupones y opciones de pago';
        document.getElementById('kueski-pay-btn').textContent = '✓ Listo';
        document.getElementById('kueski-pay-btn').disabled = true;
      });
    });

    document.getElementById('kueski-close-btn').addEventListener('click', () => {
      banner.classList.remove('kueski-banner-show');
      setTimeout(() => banner.remove(), 300);
    });
  }
})();
