// ===== KUESKI SMART WIDGET - SERVICE WORKER =====

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

// Listen for messages from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'CHECK_MERCHANT') {
    const domain = message.domain;
    const merchant = AFFILIATED_MERCHANTS.find(m => domain.includes(m.domain));
    
    if (merchant) {
      // Change extension icon badge to show it's an affiliated store
      chrome.action.setBadgeText({ text: '✓', tabId: sender.tab.id });
      chrome.action.setBadgeBackgroundColor({ color: '#2ECC71', tabId: sender.tab.id });
      sendResponse({ affiliated: true, merchant: merchant });
    } else {
      chrome.action.setBadgeText({ text: '', tabId: sender.tab.id });
      sendResponse({ affiliated: false });
    }
  }
  return true;
});

// On extension install
chrome.runtime.onInstalled.addListener(() => {
  console.log('Kueski Smart Widget installed successfully');
});
