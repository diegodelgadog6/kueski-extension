// ===== KUESKI SMART WIDGET - SERVICE WORKER =====
const API_BASE_URL = 'http://localhost:3000';

// Simulated list of affiliated merchants (domains)
const AFFILIATED_MERCHANTS = [
  { domain: 'amazon.com.mx', name: 'Amazon México', coupon: 'AMAZON15', discount: '15% off' },
  { domain: 'liverpool.com.mx', name: 'Liverpool', coupon: 'LIVERPOOL500', discount: '$500 off' },
  { domain: 'privalia.com.mx', name: 'Privalia', coupon: 'PRIVALIA10', discount: '10% off' },
  { domain: 'nike.com', name: 'Nike', coupon: 'NIKE20', discount: '20% off' },
  { domain: 'zara.com', name: 'Zara', coupon: 'ZARA15', discount: '15% off' },
  { domain: 'att.com.mx', name: 'AT&T', coupon: 'ATT_MSI', discount: 'MSI disponible' },
  { domain: 'officedepot.com.mx', name: 'Office Depot', coupon: 'OFFICE5', discount: '5% cashback' },
  { domain: 'puma.com', name: 'Puma', coupon: 'PUMA15', discount: '15% off' },
  { domain: 'adidas.com.mx', name: 'Adidas', coupon: 'ADIDAS20', discount: '20% off' },
  { domain: 'shein.com', name: 'Shein', coupon: 'SHEIN25', discount: '25% off' }
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
chrome.runtime.onInstalled.addListener(() => {
  console.log('Kueski Smart Widget installed successfully');
});
