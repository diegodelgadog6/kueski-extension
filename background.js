// ===== KUESKI SMART WIDGET - SERVICE WORKER =====
const API_BASE_URL = 'http://localhost:3000';

// Simulated list of affiliated merchants (domains)
const AFFILIATED_MERCHANTS = [
  { domain: 'amazon.com.mx', name: 'Amazon México' },
  { domain: 'liverpool.com.mx', name: 'Liverpool' },
  { domain: 'privalia.com.mx', name: 'Privalia' },
  { domain: 'nike.com', name: 'Nike' },
  { domain: 'zara.com', name: 'Zara' },
  { domain: 'att.com.mx', name: 'AT&T' },
  { domain: 'officedepot.com.mx', name: 'Office Depot' },
  { domain: 'puma.com', name: 'Puma' },
  { domain: 'adidas.com.mx', name: 'Adidas' },
  { domain: 'shein.com', name: 'Shein' }
];

async function checkMerchantFromApi(domain) {
  const response = await fetch(
    `${API_BASE_URL}/api/merchants/check?domain=${encodeURIComponent(domain)}`
  );

  if (!response.ok) {
    throw new Error(`API error ${response.status}`);
  }

  return response.json();
}

function checkMerchantFallback(domain) {
  const merchant = AFFILIATED_MERCHANTS.find(m => domain.includes(m.domain));

  if (!merchant) {
    return { affiliated: false };
  }

  return { affiliated: true, merchant };
}

async function logActivityToApi(payload) {
  const response = await fetch(`${API_BASE_URL}/api/activity`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(`API error ${response.status}`);
  }

  return response.json();
}

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CHECK_MERCHANT') {
    const domain = String(message.domain || '').toLowerCase();

    (async () => {
      try {
        let result;
        try {
          result = await checkMerchantFromApi(domain);
        } catch (_apiError) {
          result = checkMerchantFallback(domain);
        }

        if (sender.tab && result.affiliated) {
          chrome.action.setBadgeText({ text: '✓', tabId: sender.tab.id });
          chrome.action.setBadgeBackgroundColor({ color: '#2ECC71', tabId: sender.tab.id });
        } else if (sender.tab) {
          chrome.action.setBadgeText({ text: '', tabId: sender.tab.id });
        }

        sendResponse(result);
      } catch (_error) {
        if (sender.tab) {
          chrome.action.setBadgeText({ text: '', tabId: sender.tab.id });
        }
        sendResponse({ affiliated: false });
      }
    })();
  }

  if (message.type === 'OPEN_POPUP') {
    (async () => {
      try {
        if (typeof chrome.action.openPopup === 'function') {
          await chrome.action.openPopup();
          sendResponse({ ok: true });
        } else {
          sendResponse({ ok: false });
        }
      } catch (_error) {
        sendResponse({ ok: false });
      }
    })();
  }

  if (message.type === 'HIGHLIGHT_ICON') {
    let count = 0;
    const interval = setInterval(() => {
      chrome.action.setBadgeText({ text: count % 2 === 0 ? 'PAY' : '✓' });
      chrome.action.setBadgeBackgroundColor({ color: '#2ECC71' });
      count++;
      if (count > 6) {
        clearInterval(interval);
        chrome.action.setBadgeText({ text: '✓' });
      }
    }, 400);
    sendResponse({ ok: true });
  }

  if (message.type === 'LOG_ACTIVITY') {
    const payload = {
      domain: String(message.domain || '').toLowerCase(),
      action: String(message.action || '').trim(),
      details: message.details || null
    };

    (async () => {
      try {
        await logActivityToApi(payload);
        sendResponse({ ok: true });
      } catch (_error) {
        sendResponse({ ok: false });
      }
    })();
  }

  return true;
});

// On extension install
// chrome.runtime.onInstalled: no-op in production; keep commented for future setup hooks
