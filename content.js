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

  // Store-specific product-page selectors. Many sites (Nike, Adidas, Zara…) use
  // obfuscated CSS-in-JS class names, so we target their stable data-testid/id hooks.
  const PRODUCT_STORE_CONFIG = {
    'nike.com': {
      name: '#pdp_product_title, [data-testid="product_title"], [data-testid="product-title"]',
      price: '[data-testid="currentPrice-container"], [data-testid="OfferPrice"], [data-testid="initialPrice-container"], [data-testid="product-price"]',
    },
    'liverpool.com.mx': {
      name: '[data-testid="pdp-title"], h1[class*="product-name"], h1[class*="a-product-name"]',
      price: '[data-testid="pdp-price"], [class*="m-final-price"], [class*="a-price"], [itemprop="price"]',
    },
    'adidas.mx': {
      name: '[data-testid="product-title"], h1[class*="name"]',
      price: '[data-testid="product-price"], .gl-price-item--sale, .gl-price-item, [class*="gl-price-item"]',
    },
    'zara.com': {
      name: '[data-qa-qualifier="product-detail-info-name"], h1.product-detail-info__header-name',
      price: '[data-qa-qualifier="price-amount-current"], .price__amount-current, .money-amount__main',
    },
  };

  function firstTextFromSelectors(selectorString) {
    if (!selectorString) return null;
    for (const sel of selectorString.split(',').map((s) => s.trim()).filter(Boolean)) {
      const el = document.querySelector(sel);
      const text = el?.getAttribute('content') || el?.textContent;
      if (text && text.trim()) return text.trim();
    }
    return null;
  }

  function firstPriceFromSelectors(selectorString) {
    if (!selectorString) return null;
    for (const sel of selectorString.split(',').map((s) => s.trim()).filter(Boolean)) {
      for (const el of document.querySelectorAll(sel)) {
        const value = parsePriceValue(el.getAttribute('content') || el.textContent);
        if (value) return value;
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

    const storeName = firstTextFromSelectors(PRODUCT_STORE_CONFIG[currentDomain]?.name);
    if (storeName && storeName.length > 2) return cleanProductName(storeName);

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

  const PRICE_ONLY_TEXT_RE = /^\$?\s*\d{1,3}(?:[,.]\d{3})*(?:[.,]\d{2})?\s*(?:MXN|mxn|m\.?n\.?)?$/;

  function isNodeVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
  }

  // Last-resort: scan the page for the first visible element whose text is exactly a
  // price, skipping the header/nav and our own banner. On a product detail page this
  // is reliably the main product price even when class names are obfuscated.
  function extractVisibleProductPrice() {
    const nodes = document.querySelectorAll('span, strong, b, p, div, ins, bdi, h2, h3');
    for (const el of nodes) {
      if (el.children.length > 0) continue;
      if (el.closest('#kueski-banner, header, nav, footer')) continue;
      const text = el.textContent.trim();
      if (!PRICE_ONLY_TEXT_RE.test(text)) continue;
      if (!isNodeVisible(el)) continue;
      const value = parsePriceValue(text);
      if (value) return value;
    }
    return null;
  }

  function extractProductPrice() {
    const jsonLd = extractFromJsonLd();
    if (jsonLd?.price) return jsonLd.price;

    const metaPrice = document.querySelector(
      'meta[property="product:price:amount"], meta[property="og:price:amount"]'
    )?.content;
    const metaParsed = parsePriceValue(metaPrice);
    if (metaParsed) return metaParsed;

    const storePrice = firstPriceFromSelectors(PRODUCT_STORE_CONFIG[currentDomain]?.price);
    if (storePrice) return storePrice;

    const priceSelectors = [
      '[itemprop="price"]',
      '[data-test*="product-price" i]',
      '[data-testid*="price" i]',
      '[class*="current-price" i]',
      '[class*="product-price" i]',
      '[class*="price" i] [class*="current" i]',
      '.a-price .a-offscreen',
      '.product-price',
      '#priceblock_ourprice',
      '#priceblock_dealprice',
      '.price-current',
    ];

    for (const selector of priceSelectors) {
      for (const el of document.querySelectorAll(selector)) {
        const value = parsePriceValue(el.getAttribute('content') || el.textContent);
        if (value) return value;
      }
    }

    return extractVisibleProductPrice();
  }

  // URL patterns that strongly indicate a single product detail page.
  const PRODUCT_URL_PATTERNS = [
    '/dp/', '/gp/product/', '/ip/', '/product/', '/producto/',
    '/p/', '/pd/', '/prod/', '-p-', '/item/', '/itm/', '/t/',
  ];

  function urlLooksLikeProduct() {
    const path = window.location.pathname.toLowerCase();
    return PRODUCT_URL_PATTERNS.some((p) => path.includes(p));
  }

  function hasProductMicrodata() {
    return Boolean(document.querySelector('[itemtype*="/Product" i]'));
  }

  function extractProductFromPage() {
    // Never treat a cart/checkout page as a product page.
    if (isCartPage()) return null;

    // Require a product-page signal to avoid matching category/home pages, but
    // accept a broad set of signals so real product pages are auto-detected
    // (meta tags, JSON-LD, microdata, or a product-style URL).
    const hasProductSignal =
      document.querySelector(
        'meta[property="product:price:amount"], meta[property="og:price:amount"], meta[property="og:type"][content="product"]'
      ) ||
      extractFromJsonLd() !== null ||
      hasProductMicrodata() ||
      urlLooksLikeProduct();

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

  // Selectors that point at the FINAL amount to pay (grand total). Checked first.
  const FINAL_TOTAL_SELECTORS = [
    '[class*="grand-total"] [class*="amount"]',
    '[class*="grand-total"]',
    '[class*="order-total"] [class*="amount"]',
    '[class*="order-total"]',
    '[class*="total-amount"]',
    '[class*="checkout-total"]',
    '[class*="cart-total"] [class*="price"]',
    '[class*="cart-total"]',
    '[data-testid*="grand-total"]',
    '[data-testid*="order-total"]',
    '[id*="grand-total"]',
    '[id*="order-total"]',
  ];

  // Weaker total signals (subtotal / anything "total"). Only used as a fallback.
  const FALLBACK_TOTAL_SELECTORS = [
    '[class*="subtotal"]',
    '[id*="total"]',
  ];

  function lastPriceFromSelectors(selectors) {
    for (const sel of selectors) {
      const els = document.querySelectorAll(sel);
      if (!els.length) continue;
      // Take the last match — the grand total is the last row in summary sections.
      const val = parsePriceValue(els[els.length - 1]?.textContent);
      if (val && val > 0) return val;
    }
    return null;
  }

  // Only treat a string as a price if it actually carries a currency signal,
  // so labels like "Total 3 artículos" don't get parsed as the number 3.
  function priceWithCurrency(str) {
    const s = String(str || '');
    if (!/\$/.test(s) && !/\d[.,]\d{2}\b/.test(s)) return null;
    return parsePriceValue(s);
  }

  // Rows that say "total" but are NOT the amount to pay (savings/discount lines).
  const NON_PAYABLE_TOTAL = /(ahorr|saved|saving|descuento|discount|cup[oó]n|coupon)/i;

  // Find the price on the row explicitly labeled "Total" (the discounted grand
  // total), skipping "Subtotal" and savings rows. This is the value the customer
  // actually pays, so it must win over max-price heuristics that pick the
  // pre-discount amount. Returns the LAST such row — the grand total is normally
  // the final line of the summary.
  function extractTotalByLabel() {
    const nodes = document.querySelectorAll(
      'span, p, div, strong, b, dt, dd, th, td, li, h2, h3'
    );
    let found = null;

    for (const el of nodes) {
      if (el.closest('#kueski-banner')) continue;
      if (el.children.length > 3) continue;

      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 60) continue;

      const lower = text.toLowerCase();
      if (!/\btotal\b/.test(lower)) continue;
      if (/sub\s*total/.test(lower) || NON_PAYABLE_TOTAL.test(lower)) continue;
      if (!isNodeVisible(el)) continue;

      // Price sits in the same element ("Total $749").
      let value = priceWithCurrency(text);

      // Label-only cell — the price is in the sibling cell or the parent row.
      if (!value) value = priceWithCurrency(el.nextElementSibling?.textContent);
      if (!value) {
        const parent = el.parentElement;
        if (parent && !/sub\s*total/i.test(parent.textContent || '')) {
          value = priceWithCurrency(parent.textContent);
        }
      }

      if (value) found = value;
    }

    return found;
  }

  function extractCartTotal() {
    const config = CART_STORE_CONFIG[currentDomain];
    const storeSels = config?.total
      ? config.total.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    // 1) Store-specific total (most reliable).
    const storeVal = lastPriceFromSelectors(storeSels);
    if (storeVal) return storeVal;

    // 2) Row explicitly labeled "Total" — the real (discounted) amount to pay.
    const labelVal = extractTotalByLabel();
    if (labelVal) return labelVal;

    // 3) Generic "final amount to pay" selectors.
    const finalVal = lastPriceFromSelectors(FINAL_TOTAL_SELECTORS);
    if (finalVal) return finalVal;

    // 4) Weaker total/subtotal selectors.
    const fallbackVal = lastPriceFromSelectors(FALLBACK_TOTAL_SELECTORS);
    if (fallbackVal) return fallbackVal;

    // 5) Known price class names (Nike .formatted-price, Adidas Glass .gl-price__value).
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

    // 6) Class-agnostic leaf scan.
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

  // Generic cart item containers used when there's no store-specific config.
  const GENERIC_ITEM_CONTAINERS = [
    '[data-testid*="cart-item"]',
    '[class*="cart-item"]',
    '[class*="cartItem"]',
    '[class*="line-item"]',
    '[class*="lineItem"]',
    '[class*="bag-item"]',
    '[class*="basket-item"]',
    '[class*="product-line"]',
  ];

  const CART_EMPTY_PATTERNS = [
    'tu carrito está vacío', 'tu carrito esta vacio',
    'carrito vacío', 'carrito vacio',
    'tu bolsa está vacía', 'tu bolsa esta vacia',
    'tu bolsa de la compra está vacía',
    'no tienes productos', 'no hay productos en tu',
    'your cart is empty', 'your bag is empty',
    'your shopping cart is empty', 'shopping bag is empty',
  ];

  function isCartEmptyByText() {
    const text = (document.body?.innerText || '').toLowerCase();
    return CART_EMPTY_PATTERNS.some((p) => text.includes(p));
  }

  // Read the quantity for a single cart line item (e.g. "× 3"). Falls back to 1.
  function getItemQuantity(container) {
    // 1) Form controls (number input / qty select / stepper input).
    const control = container.querySelector(
      'input[type="number"], input[name*="quantity" i], input[name*="qty" i], ' +
      'input[class*="quantity" i], input[data-testid*="quantity" i], ' +
      'select[name*="quantity" i], select[name*="qty" i]'
    );
    if (control) {
      const raw = control.value || control.getAttribute('value') ||
        (control.selectedOptions && control.selectedOptions[0]?.textContent) || '';
      const v = parseInt(String(raw).replace(/[^\d]/g, ''), 10);
      if (v > 0 && v < 1000) return v;
    }

    // 2) Stepper widgets expose the value via aria attributes.
    const spin = container.querySelector('[aria-valuenow], [role="spinbutton"]');
    if (spin) {
      const v = parseInt(spin.getAttribute('aria-valuenow') || spin.textContent, 10);
      if (v > 0 && v < 1000) return v;
    }

    // 3) Elements explicitly tagged as quantity.
    const qtyEl = container.querySelector(
      '[data-testid*="quantity" i], [data-automation*="quantity" i], [class*="quantity" i], ' +
      '[aria-label*="cantidad" i], [aria-label*="quantity" i]'
    );
    if (qtyEl) {
      const source = qtyEl.getAttribute('aria-label') || qtyEl.value || qtyEl.textContent || '';
      const m = source.match(/\d+/);
      if (m) {
        const v = parseInt(m[0], 10);
        if (v > 0 && v < 1000) return v;
      }
    }

    return 1;
  }

  // Total number of units in the cart (sums per-line quantities, not just line count).
  function countCartItems() {
    const config = CART_STORE_CONFIG[currentDomain];
    const selectorSets = [];
    if (config?.itemContainer) selectorSets.push(config.itemContainer);
    selectorSets.push(...GENERIC_ITEM_CONTAINERS);

    for (const sel of selectorSets) {
      const els = Array.from(document.querySelectorAll(sel)).filter(isElementVisible);
      if (els.length) {
        return els.reduce((sum, el) => sum + getItemQuantity(el), 0);
      }
    }
    return 0;
  }

  function extractCart() {
    if (!isCartPage()) return null;

    const itemCount = countCartItems();
    const total = extractCartTotal();

    // Empty cart: explicit empty message, or no items and no total found.
    if (isCartEmptyByText() || (itemCount === 0 && !total)) {
      return { empty: true, total: 0, itemCount: 0, domain: currentDomain, detectedAt: Date.now() };
    }

    if (!total) return null;

    return { total, itemCount, empty: false, domain: currentDomain, detectedAt: Date.now() };
  }

  function publishCartContext(cart) {
    if (!cart) return;
    chrome.runtime.sendMessage({
      type: 'SET_CART_CONTEXT',
      domain: currentDomain,
      cart,
    });
  }

  function scanAndPublishCart() {
    const cart = extractCart();
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

