// ===== KUESKI SMART WIDGET - CONTENT SCRIPT =====

(function () {
  function normalizeMerchantHost(hostname) {
    return String(hostname || '')
      .replace(/^www\./i, '')
      .replace(/^m\./i, '')
      .toLowerCase();
  }

  const currentDomain = normalizeMerchantHost(window.location.hostname);

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

  const HEADER_SELECTORS = [
    '.shein-header',
    '.c-nav-bar',
    '.c-nav',
    '[class*="header_container"]',
    '[class*="common-header"]',
    'header[role="banner"]',
    'header',
    '[role="banner"]',
    'nav[aria-label*="main" i]',
    'nav.global-header',
    '#header',
    '#navbar',
    '#nav-main',
    '.site-header',
    '.global-header',
    '.header',
    'nav',
  ];

  function isElementVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    return rect.height > 24 && rect.width > 100;
  }

  function isNearPageTop(el) {
    const top = el.getBoundingClientRect().top;
    return top >= -20 && top <= 160;
  }

  function isFixedOrSticky(el) {
    const pos = getComputedStyle(el).position;
    return pos === 'fixed' || pos === 'sticky';
  }

  function findTopFixedBar() {
    const nodes = document.body?.querySelectorAll('div, nav, header') || [];
    let best = null;
    let bestTop = Infinity;

    for (const el of nodes) {
      if (el.id === 'kueski-banner' || el.closest('#kueski-banner')) continue;
      if (!isFixedOrSticky(el) || !isElementVisible(el)) continue;
      const top = el.getBoundingClientRect().top;
      if (top > 80) continue;
      if (top < bestTop) {
        bestTop = top;
        best = el;
      }
    }

    return best;
  }

  function findHeaderAnchor() {
    let best = null;
    let bestTop = Infinity;

    for (const selector of HEADER_SELECTORS) {
      const candidates = document.querySelectorAll(selector);
      for (const el of candidates) {
        if (el.id === 'kueski-banner' || el.closest('#kueski-banner')) continue;
        if (!isElementVisible(el) || !isNearPageTop(el)) continue;
        const top = el.getBoundingClientRect().top;
        if (top < bestTop) {
          bestTop = top;
          best = el;
        }
      }
    }

    return best || findTopFixedBar();
  }

  function applyBannerLayout(banner, anchor) {
    banner.style.marginTop = '';
    if (!anchor) return;

    if (isFixedOrSticky(anchor)) {
      banner.style.marginTop = `${Math.ceil(anchor.getBoundingClientRect().height)}px`;
    }
  }

  function watchBannerLayout(banner, anchor) {
    applyBannerLayout(banner, anchor);
    if (!anchor || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => applyBannerLayout(banner, anchor));
    observer.observe(anchor);
  }

  function bannerStorageKey(domain) {
    return `kueskiBannerDismissed_${domain}`;
  }

  async function isBannerDismissed(domain) {
    try {
      const stored = await chrome.storage.session.get([bannerStorageKey(domain)]);
      return stored[bannerStorageKey(domain)] === true;
    } catch (_err) {
      return false;
    }
  }

  async function rememberBannerDismissed(domain) {
    try {
      await chrome.storage.session.set({ [bannerStorageKey(domain)]: true });
    } catch (_err) {
      // Ignore storage errors in content script.
    }
  }

  function wireBannerEvents(banner, merchant) {
    banner.querySelector('#kueski-pay-btn')?.addEventListener('click', () => {
      const product = scanAndPublishProduct();

      chrome.runtime.sendMessage(
        { type: 'OPEN_POPUP', domain: currentDomain, product },
        (response) => {
          if (response && response.ok) return;

          chrome.runtime.sendMessage({ type: 'HIGHLIGHT_ICON' });
          chrome.runtime.sendMessage({
            type: 'LOG_ACTIVITY',
            domain: currentDomain,
            action: 'opened_widget',
            details: `Pago iniciado en ${merchant.name}`,
          });

          const hint = banner.querySelector('.kueski-banner-text span');
          const payBtn = banner.querySelector('#kueski-pay-btn');
          if (hint) {
            hint.textContent =
              'Abre la extensión de Kueski en tu toolbar para ver cupones y opciones de pago';
          }
          if (payBtn) {
            payBtn.textContent = '✓ Listo';
            payBtn.disabled = true;
          }
        }
      );
    });

    banner.querySelector('#kueski-close-btn')?.addEventListener('click', () => {
      banner.classList.add('kueski-banner-hiding');
      rememberBannerDismissed(currentDomain);
      setTimeout(() => banner.remove(), 320);
    });
  }

  function createBannerElement(merchant) {
    const banner = document.createElement('div');
    banner.id = 'kueski-banner';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Kueski Pay');
    banner.innerHTML = `
      <div class="kueski-banner-content">
        <img class="kueski-banner-logo-img" src="${chrome.runtime.getURL('assets/kueski-logo.webp')}" alt="Kueski">
        <div class="kueski-banner-text">
          <strong>Paga con Kueski Pay en ${merchant.name}</strong>
          <span>Compra ahora y paga en quincenas, sin tarjeta de crédito</span>
        </div>
        <button class="kueski-banner-btn" id="kueski-pay-btn" type="button">Pagar con Kueski Pay</button>
        <button class="kueski-banner-close" id="kueski-close-btn" type="button" aria-label="Cerrar">✕</button>
      </div>
    `;
    return banner;
  }

  function mountKueskiBanner(merchant) {
    const anchor = findHeaderAnchor();
    if (!document.body) return false;

    let banner = document.getElementById('kueski-banner');
    if (!banner) {
      banner = createBannerElement(merchant);
      wireBannerEvents(banner, merchant);
    }

    if (anchor) {
      if (banner.previousElementSibling !== anchor) {
        anchor.insertAdjacentElement('afterend', banner);
      }
      watchBannerLayout(banner, anchor);
      return true;
    }

    if (banner.parentElement !== document.body || banner !== document.body.firstElementChild) {
      document.body.insertBefore(banner, document.body.firstChild);
    }
    applyBannerLayout(banner, null);
    return false;
  }

  function initKueskiBanner(merchant) {
    const ensureMounted = () => {
      const hadAnchor = mountKueskiBanner(merchant);
      if (!document.getElementById('kueski-banner')) {
        mountKueskiBanner(merchant);
      }
      return hadAnchor;
    };

    if (ensureMounted()) return;

    const observer = new MutationObserver(() => {
      if (ensureMounted()) {
        observer.disconnect();
      }
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('load', ensureMounted, { once: true });
    setTimeout(() => observer.disconnect(), 15000);
  }

  chrome.runtime.sendMessage(
    { type: 'CHECK_MERCHANT', domain: currentDomain },
    async (response) => {
      if (!response?.affiliated) return;

      const dismissed = await isBannerDismissed(currentDomain);
      if (dismissed) return;

      scanAndPublishProduct();
      initKueskiBanner(response.merchant);
      chrome.runtime.sendMessage({
        type: 'LOG_ACTIVITY',
        domain: currentDomain,
        action: 'viewed_payment_promo',
        details: `Banner insertado para ${response.merchant.name}`,
      });
    }
  );

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'GET_PRODUCT_CONTEXT') {
      sendResponse({ product: scanAndPublishProduct() });
      return true;
    }
    return false;
  });
})();

