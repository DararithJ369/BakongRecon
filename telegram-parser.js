function parsePayWayDateTime(dateStr, timeStr) {
  try {
    const MONTH_MAP = {
      Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
      Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11
    };

    const [monthAbbr, dayStr] = dateStr.trim().split(' ');
    const month = MONTH_MAP[monthAbbr];
    const day = parseInt(dayStr, 10);
    const year = new Date().getFullYear();

    let [hhmm, meridiem] = timeStr.trim().split(' ');
    let [hours, minutes] = hhmm.split(':').map(Number);
    if (meridiem === 'PM' && hours !== 12) hours += 12;
    if (meridiem === 'AM' && hours === 12) hours = 0;

    const d = new Date(year, month, day, hours, minutes, 0);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
  } catch (error) {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
  }
}

function extractTransactionId(text) {
  const cleanText = text.replace(/\s+/g, ' ').trim();

  const ftPattern = /(?:ref|reference)[^\w\n]*([0-9]*FT[A-Z0-9]+)/i;
  const matchFt = cleanText.match(ftPattern);
  if (matchFt) {
    return matchFt[1].toUpperCase().trim();
  }

  const rawFtPattern = /\b\d{3,}FT[A-Z0-9]+\b/i;
  const matchRawFt = cleanText.match(rawFtPattern);
  if (matchRawFt) {
    return matchRawFt[0].toUpperCase().trim();
  }

  const trxPattern = /(?:trx\.?\s*id|transaction\s*id)[^\w\n]*(\d{8,20})/i;
  const matchTrx = cleanText.match(trxPattern);
  if (matchTrx) {
    return matchTrx[1].trim();
  }

  const khqrPattern = /KHQR[-\s]*\d{8}[-\s]*[A-Z]/i;
  const matchKhqr = cleanText.match(khqrPattern);
  if (matchKhqr) {
    return matchKhqr[0].toUpperCase().replace(/\s/g, '').replace(/(KHQR)(\d{8})([A-Z])/, '$1-$2-$3');
  }

  const refPattern = /(?:txn|ref|reference|trace|id)[^0-9\n]*(\d{8,20})/i;
  const matchRef = cleanText.match(refPattern);
  if (matchRef) {
    return matchRef[1].trim();
  }

  const numberPattern = /\b\d{8,20}\b/;
  const matchNumber = cleanText.match(numberPattern);
  if (matchNumber) {
    return matchNumber[0];
  }

  return null;
}

function parseBankNotification(text) {
  const clean = text.replace(/\s+/g, ' ').trim();

  const payWayRegex = /([៛$])\s*([\d,]+(?:\.\d+)?)\s+paid by\s+(.+?)\s+\(\*(\d+)\)\s+on\s+(\w{3}\s+\d{1,2}),\s+([\d:]+\s+[AP]M)\s+via\s+ABA\s+(PAY|KHQR)(?:\s+\(([^)]+)\))?\s+at\s+(.+?)\s*\.\s+Trx\.\s*ID:\s*(\d{8,20}),\s*APV:\s*(\d+)/i;
  const payWayMatch = clean.match(payWayRegex);

  if (payWayMatch) {
    const [, amountSymbol, amountStr, senderName, phoneDigits, dateStr, timeStr, paymentType, merchantBank, merchantName, trxId, apv] = payWayMatch;
    const currency = amountSymbol === '៛' || /KHR/i.test(clean) ? 'KHR' : 'USD';
    const merchant = (merchantName || merchantBank || 'N/A').trim();

    return {
      id: trxId,
      trxId,
      apv,
      amount: parseFloat(amountStr.replace(/,/g, '')),
      currency,
      sender: `${senderName.trim()} (*${phoneDigits})`,
      merchant: merchant.trim(),
      date: parsePayWayDateTime(dateStr, timeStr),
      source: `ABA ${paymentType.toUpperCase()} (Auto-scraped)`,
      claimed: false,
      claimedBy: null,
      claimTime: null
    };
  }

  let id = null;

  const ftMatch = clean.match(/\b\d*FT[A-Z0-9]+\b/i);
  if (ftMatch) id = ftMatch[0].toUpperCase().trim();

  if (!id) {
    const khqrMatch = clean.match(/KHQR[-\s]*\d{8}[-\s]*[A-Z]/i);
    if (khqrMatch) {
      id = khqrMatch[0].toUpperCase().replace(/\s/g, '').replace(/(KHQR)(\d{8})([A-Z])/, '$1-$2-$3');
    }
  }

  if (!id) {
    const refMatch = clean.match(/(?:ref|reference|trx\.?\s*id|transaction\s*id)[^\w\n]*([A-Z0-9-]{8,20})/i);
    if (refMatch) id = refMatch[1].toUpperCase().trim();
  }

  if (!id) return null;

  let amount = 0.0;
  let currency = /៛|KHR/i.test(clean) ? 'KHR' : 'USD';
  const amountMatch = clean.match(/([៛$])\s*([\d,.]+(?:\.\d+)?)|(?:USD|KHR)\s*([\d,.]+(?:\.\d+)?)|([\d,.]+(?:\.\d+)?)\s*(?:USD|KHR)/i);
  if (amountMatch) {
    const rawVal = amountMatch[2] || amountMatch[3] || amountMatch[4];
    amount = parseFloat(rawVal.replace(/,/g, '')) || 0.0;
    if (amountMatch[1] === '៛' || clean.toUpperCase().includes('KHR')) currency = 'KHR';
    else if (amountMatch[1] === '$' || clean.toUpperCase().includes('USD')) currency = 'USD';
  }

  let sender = 'Unknown Sender';
  const senderMatch = clean.match(/paid by\s+(.+?)\s+\(\*\d+\)/i) || clean.match(/from\s+(?:account\s+)?(.+?)(?:\s*\(|\s*\.|\s*Ref|\s*Date|\s*Transaction|\s+at\s+)/i);
  if (senderMatch) {
    sender = senderMatch[1].trim();
  } else {
    const simpleSenderMatch = clean.match(/from\s+(.+?)(?:\s+at\s+|\s*\.|\s*$)/i);
    if (simpleSenderMatch) sender = simpleSenderMatch[1].trim();
  }

  let merchant = 'N/A';
  const merchantMatch = clean.match(/\s+at\s+(.+?)(?:\s*\.\s*Trx\.?|\s*\.\s*Reference|\s*\.\s*APV|\s*$)/i);
  if (merchantMatch) {
    merchant = merchantMatch[1].replace(/\s+\([^)]*\)/g, '').trim();
  }

  let date = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const dateMatch = clean.match(/on\s+(\w{3}\s+\d{1,2}),\s+([\d:]+\s+[AP]M)/i);
  if (dateMatch) {
    date = parsePayWayDateTime(dateMatch[1], dateMatch[2]);
  }

  const apvMatch = clean.match(/APV:\s*(\d+)/i);

  return {
    id,
    trxId: id,
    amount,
    currency,
    sender,
    merchant,
    date,
    apv: apvMatch ? apvMatch[1] : null,
    source: /ABA\s+(PAY|KHQR)/i.test(clean) ? 'ABA Pay/KHQR (Auto-scraped)' : 'Manual/Forward',
    claimed: false,
    claimedBy: null,
    claimTime: null
  };
}

function parseReceiptOcrText(text) {
  const clean = text.replace(/\s+/g, ' ').trim();

  const referenceMatch = clean.match(/Reference\s*#:\s*([A-Z0-9-]{8,20})/i);
  const trxMatch = clean.match(/Trx\.?\s*ID:\s*(\d{8,20})/i);
  const apvMatch = clean.match(/APV:\s*(\d+)/i);
  const senderMatch = clean.match(/From account:\s*(.+?)(?:\s+Original amount:|\s+Purchase #:|\s+Reference #:|\s+Seller:|\s+Transaction date:|$)/i);
  const amountMatch = clean.match(/Original amount:\s*([៛$]?\s*\d[\d,.]*(?:\.\d+)?)(?:\s*(KHR|USD))?/i) || clean.match(/[-−]\s*([៛$])?\s*([\d,.]+(?:\.\d+)?)\s*(KHR|USD)?/i);
  const merchantMatch = clean.match(/Seller:\s*(.+?)(?:\s+Transaction date:|$)/i);
  const dateMatch = clean.match(/Transaction date:\s*(\w{3}\s+\d{2},\s+\d{4})\s*(\d{2}:\d{2}\s+[AP]M)/i);

  if (!referenceMatch && !trxMatch) {
    return null;
  }

  let amount = 0;
  let currency = 'USD';
  if (amountMatch) {
    const rawAmount = (amountMatch[1] || amountMatch[2] || '').replace(/[៛$,]/g, '').trim();
    amount = parseFloat(rawAmount) || 0;
    if (/KHR/i.test(clean) || (amountMatch[1] && amountMatch[1].includes('៛')) || amountMatch[3] === 'KHR') {
      currency = 'KHR';
    }
  }

  const date = dateMatch ? parsePayWayDateTime(dateMatch[1], dateMatch[2]) : new Date().toISOString().replace('T', ' ').substring(0, 19);
  const referenceId = referenceMatch ? referenceMatch[1].toUpperCase().trim() : trxMatch[1].trim();
  const trxId = trxMatch ? trxMatch[1].trim() : referenceId;

  return {
    id: referenceId,
    trxId,
    apv: apvMatch ? apvMatch[1] : null,
    amount,
    currency,
    sender: senderMatch ? senderMatch[1].trim() : 'Unknown Sender',
    merchant: merchantMatch ? merchantMatch[1].trim() : 'N/A',
    date,
    source: 'ABA Receipt OCR',
    claimed: false,
    claimedBy: null,
  };
}

function verifyAuditBotSender(from, expectedUsername = 'auditbot') {
  if (!from) return false;
  
  const senderIsBot = from.is_bot === true;
  const senderUsername = from.username || '';
  const senderFirstName = from.first_name || '';

  return senderIsBot && (
    senderUsername.toLowerCase() === expectedUsername.toLowerCase() ||
    senderUsername.toLowerCase().includes('audit') ||
    senderFirstName.toLowerCase().includes('audit') ||
    senderUsername.toLowerCase().includes('aba') ||
    senderFirstName.toLowerCase().includes('aba')
  );
}

module.exports = {
  extractTransactionId,
  parsePayWayDateTime,
  parseBankNotification,
  parseReceiptOcrText,
  verifyAuditBotSender
};
