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
    // Require explicit product-page signals to avoid matching category/home pages.
    // Category pages have many prices but no product-specific meta or JSON-LD.
    const hasProductSignal =
      document.querySelector(
        'meta[property="product:price:amount"], meta[property="og:price:amount"], meta[property="og:type"][content="product"]'
      ) || extractFromJsonLd() !== null;

    if (!hasProductSignal) return null;

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

  // ===== CART DETECTION =====

  const CART_URL_PATTERNS = [
    '/cart', '/checkout', '/carrito', '/bolsa', '/bag', '/basket',
    '/comprar', '/pago', '/gp/cart',
  ];

  function isCartPage() {
    const path = window.location.pathname.toLowerCase();
    return CART_URL_PATTERNS.some((p) => path.includes(p));
  }

  const ADIDAS_CONFIG = {
    itemContainer: '.gl-order-summary__item, [class*="order-summary__item"], [class*="order-summary-item"], [class*="checkout-product-card"]',
    itemName: '.gl-label, [class*="gl-label"], [class*="product-card-description__name"], [class*="product-description-name"], h3',
    itemPrice: '.gl-price__value, [class*="gl-price__value"], [class*="gl-price-item"]',
    total: '[class*="order-totals"] .gl-price__value, [class*="order-summary__totals"] .gl-price__value, [class*="gl-order-summary__total"] .gl-price__value',
  };

  const CART_STORE_CONFIG = {
    'amazon.com.mx': {
      itemContainer: '.sc-list-item[data-itemtype="active"], .sc-list-item',
      itemName: '[data-name], .sc-product-title, .a-truncate-cut, .a-list-item .a-size-medium',
      itemPrice: '.sc-product-price, .sc-price, .a-price .a-offscreen',
      total: '#sc-subtotal-amount-activecart, [id*="subtotal-amount"] .a-size-medium',
    },
    'liverpool.com.mx': {
      itemContainer: '.product-line-item, [class*="cartItem"], [class*="cart-item"]',
      itemName: '[class*="product-name"], [class*="item-name"], .line-item-name',
      itemPrice: '[class*="price"], .line-item-total-price-amount',
      total: '[class*="order-total"], [class*="grand-total"], [class*="cart-total"]',
    },
    'nike.com': {
      itemContainer: '[data-testid="product-card"], [data-automation="cart-item"], [class*="cart-item"], li[class*="product"]',
      itemName: '[data-testid="product-description"], [data-automation="product-description"], [class*="product-description"], [class*="headline"], h5',
      itemPrice: '.formatted-price',
      total: null, // Nike uses CSS-in-JS; fall through to max .formatted-price strategy
    },
    'adidas.mx': ADIDAS_CONFIG,
    'adidas.com.mx': ADIDAS_CONFIG,
  };

  const GENERIC_TOTAL_SELECTORS = [
    '[class*="order-total"] [class*="amount"]',
    '[class*="cart-total"] [class*="price"]',
    '[class*="grand-total"]',
    '[class*="total-amount"]',
    '[class*="checkout-total"]',
    '[class*="subtotal"]',
    '[id*="total"]',
  ];

  function extractCartTotal() {
    const config = CART_STORE_CONFIG[currentDomain];

    const storeSels = config?.total
      ? config.total.split(', ').map((s) => s.trim())
      : [];

    for (const sel of [...storeSels, ...GENERIC_TOTAL_SELECTORS]) {
      const els = document.querySelectorAll(sel);
      if (!els.length) continue;
      // Take the last match — grand total is always the last row in checkout summary sections
      const val = parsePriceValue(els[els.length - 1]?.textContent);
      if (val && val > 0) return val;
    }

    // Last-resort pass 1: known price class names (Nike .formatted-price, Adidas Glass .gl-price__value)
    const knownPriceEls = [
      ...document.querySelectorAll('.formatted-price'),
      ...document.querySelectorAll('.gl-price__value, [class*="gl-price__value"]'),
    ];
    if (knownPriceEls.length) {
      const values = knownPriceEls
        .map((el) => parsePriceValue(el.textContent))
        .filter((v) => v != null && v > 0);
      if (values.length) {
        const max = Math.max(...values);
        if (max > 0) return max;
      }
    }

    // Last-resort pass 2: class-agnostic leaf scan.
    // Find every leaf element (no children) whose ENTIRE text content is a price string.
    // The cart grand total is always the largest such value on the cart page.
    const leafEls = document.querySelectorAll('span, strong, b, p, div');
    const leafValues = [];
    for (const el of leafEls) {
      if (el.children.length > 0) continue;
      const text = el.textContent.trim();
      if (!/^\$?\s*[\d]{1,3}(?:[,.][\d]{3})*(?:[.,]\d{2})?$/.test(text)) continue;
      const val = parsePriceValue(text);
      if (val && val > 0) leafValues.push(val);
    }
    if (leafValues.length) {
      const max = Math.max(...leafValues);
      if (max > 0) return max;
    }

    return null;
  }

  function extractCartFromPage() {
    if (!isCartPage()) return null;

    const total = extractCartTotal();
    if (!total) return null;

    return { total, domain: currentDomain, detectedAt: Date.now() };
  }

  function publishCartContext(cart) {
    if (!cart?.total) return;
    chrome.runtime.sendMessage({
      type: 'SET_CART_CONTEXT',
      domain: currentDomain,
      cart,
    });
  }

  function scanAndPublishCart() {
    const cart = extractCartFromPage();
    if (cart) publishCartContext(cart);
    return cart;
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
      const product = isCartPage() ? null : scanAndPublishProduct();
      const cart = scanAndPublishCart();

      chrome.runtime.sendMessage(
        { type: 'OPEN_POPUP', domain: currentDomain, product, cart },
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

      if (!isCartPage()) scanAndPublishProduct();
      scanAndPublishCart();
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
      // Never return a product on cart pages — it would pick up page titles like "Bag"
      sendResponse({ product: isCartPage() ? null : scanAndPublishProduct() });
      return true;
    }
    if (message.type === 'GET_CART_CONTEXT') {
      sendResponse({ cart: scanAndPublishCart() });
      return true;
    }
    return false;
  });
})();

