// ===== KUESKI SMART WIDGET - CONTENT SCRIPT =====

(function () {
  const currentDomain = window.location.hostname.replace(/^www\./i, '');

  function parsePriceValue(raw) {
    if (raw == null) return null;
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;

    const str = String(raw).trim();
    const match = str.replace(/\s/g, '').match(/(\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+(?:\.\d{2})?)/);
    if (!match) return null;

    const num = parseFloat(match[1].replace(/,/g, ''));
    return num > 0 && num < 10000000 ? num : null;
  }

  function cleanProductName(name) {
    return String(name || '')
      .replace(/\s+/g, ' ')
      .replace(/\s*[|\-–—]\s*(Comprar|Buy|Nike|Amazon|Liverpool).*$/i, '')
      .trim()
      .slice(0, 140);
  }

  function extractFromJsonLd() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');

    for (const script of scripts) {
      try {
        const data = JSON.parse(script.textContent);
        const nodes = Array.isArray(data) ? data : [data];

        for (const node of nodes) {
          const items = node['@graph'] || [node];
          for (const item of items) {
            const type = String(item['@type'] || '').toLowerCase();
            if (!type.includes('product')) continue;

            const offers = Array.isArray(item.offers) ? item.offers[0] : item.offers;
            const price = parsePriceValue(
              offers?.price || offers?.lowPrice || item.price
            );
            const name = cleanProductName(item.name);

            if (name && price) return { name, price };
          }
        }
      } catch (_err) {
        // Ignore malformed JSON-LD blocks.
      }
    }

    return null;
  }

  function extractProductName() {
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
    if (ogTitle) {
      const cleaned = cleanProductName(ogTitle);
      if (cleaned.length > 3) return cleaned;
    }

    const jsonLd = extractFromJsonLd();
    if (jsonLd?.name) return jsonLd.name;

    const selectors = [
      'h1[data-testid*="product"]',
      'h1[id*="product"]',
      'h1.product-title',
      'h1[class*="product"]',
      '[data-test="product-title"]',
      '[itemprop="name"]',
      '#title',
      'h1',
    ];

    for (const selector of selectors) {
      const el = document.querySelector(selector);
      const text = el?.textContent?.trim();
      if (text && text.length > 2 && text.length < 160) {
        return cleanProductName(text);
      }
    }

    return document.title ? cleanProductName(document.title) : null;
  }

  function extractProductPrice() {
    const jsonLd = extractFromJsonLd();
    if (jsonLd?.price) return jsonLd.price;

    const metaPrice = document.querySelector(
      'meta[property="product:price:amount"], meta[property="og:price:amount"]'
    )?.content;
    const metaParsed = parsePriceValue(metaPrice);
    if (metaParsed) return metaParsed;

    const priceSelectors = [
      '[itemprop="price"]',
      '[data-test="product-price"]',
      '[data-testid*="price"]',
      '[class*="price"] [class*="current"]',
      '[class*="Price"]',
      '.a-price .a-offscreen',
      '.product-price',
      '#priceblock_ourprice',
      '#priceblock_dealprice',
      '.price-current',
    ];

    for (const selector of priceSelectors) {
      const el = document.querySelector(selector);
      const value = parsePriceValue(el?.getAttribute('content') || el?.textContent);
      if (value) return value;
    }

    return null;
  }

  function extractProductFromPage() {
    const name = extractProductName();
    const price = extractProductPrice();

    if (!name || !price) return null;
    return { name, price, domain: currentDomain, detectedAt: Date.now() };
  }

  function publishProductContext(product) {
    if (!product?.name || !product?.price) return;

    chrome.runtime.sendMessage({
      type: 'SET_PRODUCT_CONTEXT',
      domain: currentDomain,
      product: {
        name: product.name,
        price: product.price,
        domain: currentDomain,
        detectedAt: product.detectedAt || Date.now(),
      },
    });
  }

  function scanAndPublishProduct() {
    const product = extractProductFromPage();
    if (product) publishProductContext(product);
    return product;
  }

  chrome.runtime.sendMessage(
    { type: 'CHECK_MERCHANT', domain: currentDomain },
    (response) => {
      if (response && response.affiliated) {
        scanAndPublishProduct();
        showKueskiBanner(response.merchant);
        chrome.runtime.sendMessage({
          type: 'LOG_ACTIVITY',
          domain: currentDomain,
          action: 'viewed_payment_promo',
          details: `Banner mostrado para ${response.merchant.name}`,
        });
      }
    }
  );

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'GET_PRODUCT_CONTEXT') {
      sendResponse({ product: scanAndPublishProduct() });
      return true;
    }
    return false;
  });

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
      const product = scanAndPublishProduct();

      chrome.runtime.sendMessage(
        { type: 'OPEN_POPUP', domain: currentDomain, product },
        (response) => {
          if (response && response.ok) {
            return;
          }

          chrome.runtime.sendMessage({ type: 'HIGHLIGHT_ICON' });
          chrome.runtime.sendMessage({
            type: 'LOG_ACTIVITY',
            domain: currentDomain,
            action: 'opened_widget',
            details: `Pago iniciado en ${merchant.name}`,
          });

          document.querySelector('.kueski-banner-text span').textContent =
            'Abre la extensión de Kueski en tu toolbar para ver cupones y opciones de pago';
          document.getElementById('kueski-pay-btn').textContent = '✓ Listo';
          document.getElementById('kueski-pay-btn').disabled = true;
        }
      );
    });

    document.getElementById('kueski-close-btn').addEventListener('click', () => {
      banner.classList.remove('kueski-banner-show');
      setTimeout(() => banner.remove(), 300);
    });
  }
})();
