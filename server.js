require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const Tesseract = require('tesseract.js');
const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');
const { extractTransactionId: parseTelegramTransactionId, parseBankNotification: parseTelegramBankNotification, verifyAuditBotSender, parseReceiptOcrText } = require('./telegram-parser');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Configure Multer in-memory storage for handling simulated canvas uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const DB_PATH = path.join(__dirname, 'bank_database.json');

// Initialize / Load Bank DB from file
let bankDatabase = [];

function loadBankDatabase() {
  try {
    if (fs.existsSync(DB_PATH)) {
      const data = fs.readFileSync(DB_PATH, 'utf8');
      bankDatabase = JSON.parse(data);
      console.log(`Loaded ${bankDatabase.length} records from JSON database.`);
    } else {
      // Default mock records
      bankDatabase = [
        { id: 'KHQR-98327491-B', trxId: '98327491', amount: 120.00, currency: 'USD', sender: 'Sokha Lim', date: '2026-07-04 10:23:45', claimed: false, claimedBy: null, claimTime: null },
        { id: 'KHQR-77263541-D', trxId: '77263541', amount: 15.50, currency: 'USD', sender: 'Dara Sam', date: '2026-07-04 11:45:12', claimed: false, claimedBy: null, claimTime: null },
        { id: 'KHQR-01928374-P', trxId: '01928374', amount: 450.00, currency: 'USD', sender: 'Nita Vanh', date: '2026-07-04 12:15:30', claimed: false, claimedBy: null, claimTime: null },
        { id: 'KHQR-11223344-K', trxId: '11223344', amount: 1200.00, currency: 'USD', sender: 'Vannak Chen', date: '2026-07-04 12:55:00', claimed: false, claimedBy: null, claimTime: null },
        { id: 'KHQR-88889999-R', trxId: '88889999', amount: 35.00, currency: 'USD', sender: 'Srey Mao', date: '2026-07-04 13:02:10', claimed: false, claimedBy: null, claimTime: null },
        { id: '100FT38197949889', trxId: '56868300340', amount: 12623.52, currency: 'KHR', sender: 'LY LAISRUN', date: '2026-07-04 06:46:00', claimed: false, claimedBy: null, claimTime: null }
      ];
      saveBankDatabase();
      console.log('Initialized JSON database with default mock records.');
    }
  } catch (err) {
    console.error('Error loading bank database:', err);
  }
}

function saveBankDatabase() {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(bankDatabase, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving bank database:', err);
  }
}

// Call on startup
loadBankDatabase();

// Stats tracker
let stats = {
  totalScans: 0,
  verifiedCount: 0,
  fraudBlockedCount: 0
};

// Activity log for ledger stream
let ledgerLogs = [];

// ==========================================
// OCR HELPER: EXTRACT TRANSACTION ID
// ==========================================
function extractTransactionId(text) {
  console.log('--- OCR Raw Text Extracted ---');
  console.log(text);
  console.log('------------------------------');

  // Normalize text: replace multiple spaces/newlines
  const cleanText = text.replace(/\s+/g, ' ').trim();

  // Pattern 1: ABA Reference # / FT ID (e.g., 100FT38197949889)
  // Look for "Reference #" or "Ref #" followed by alphanumeric string containing FT
  const ftPattern = /(?:ref|reference)[^\w\n]*([0-9]*FT[A-Z0-9]+)/i;
  const matchFt = text.match(ftPattern);
  if (matchFt) {
    return matchFt[1].toUpperCase().trim();
  }

  // Generic fallback for any FT string in the text (e.g. 100FT38197949889)
  const rawFtPattern = /\b\d{3}FT[A-Z0-9]+\b/i;
  const matchRawFt = text.match(rawFtPattern);
  if (matchRawFt) {
    return matchRawFt[0].toUpperCase().trim();
  }

  // Pattern 2: ABA / Acleda Trx ID (e.g. Trx. ID: 56868300340)
  // Usually "Trx. ID" or "Trx ID" followed by 8-20 digits
  const trxPattern = /(?:trx\.?\s*id|transaction\s*id)[^\w\n]*(\d{8,20})/i;
  const matchTrx = text.match(trxPattern);
  if (matchTrx) {
    return matchTrx[1].trim();
  }

  // Pattern 3: Bakong KHQR-XXXXXXXX-X
  const khqrPattern = /KHQR[-\s]*\d{8}[-\s]*[A-Z]/i;
  const matchKhqr = text.match(khqrPattern);
  if (matchKhqr) {
    return matchKhqr[0].toUpperCase().replace(/\s/g, '').replace(/(KHQR)(\d{8})([A-Z])/, '$1-$2-$3');
  }

  // Pattern 4: Generic Transaction ID prefixes, looking for 8-12 digits
  const refPattern = /(?:txn|ref|reference|trace|id)[^0-9\n]*(\d{8,20})/i;
  const matchRef = text.match(refPattern);
  if (matchRef) {
    return matchRef[1].trim();
  }

  // Pattern 5: Any raw sequence of 8-20 numbers
  const numberPattern = /\b\d{8,20}\b/;
  const matchNumber = text.match(numberPattern);
  if (matchNumber) {
    return matchNumber[0];
  }

  return null;
}

// ==========================================
// SCAPER HELPER: PARSE TELEGRAM BANK NOTIFICATION
// ==========================================

// Month abbreviation map for PayWay date parsing
const MONTH_MAP = {
  Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5,
  Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11
};

function parsePayWayDateTime(dateStr, timeStr) {
  // dateStr: "Jul 04"  timeStr: "02:14 PM"
  try {
    const [monthAbbr, dayStr] = dateStr.trim().split(' ');
    const month = MONTH_MAP[monthAbbr];
    const day = parseInt(dayStr, 10);
    const year = new Date().getFullYear();

    let [hhmm, meridiem] = timeStr.trim().split(' ');
    let [hours, minutes] = hhmm.split(':').map(Number);
    if (meridiem === 'PM' && hours !== 12) hours += 12;
    if (meridiem === 'AM' && hours === 12) hours = 0;

    const d = new Date(year, month, day, hours, minutes, 0);
    // Format: 2026-07-04 14:14:00
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
  } catch (e) {
    return new Date().toISOString().replace('T', ' ').substring(0, 19);
  }
}

function parseBankNotification(text) {
  const clean = text.replace(/\s+/g, ' ').trim();

  // ─────────────────────────────────────────────────────────────
  // FORMAT 1: PayWay / ABA KHQR by ABA bot
  // Examples:
  // "$100 paid by LY LAISRUN (*964) on Jul 04, 02:14 PM via ABA PAY at KIM PUTDARARITH. Trx. ID: 178314927151090, APV: 444368."
  // "៛100 paid by Hoa Ratha (*221) on Jul 04, 02:18 PM via ABA KHQR (ACLEDA Bank Plc.) at KIM PUTDARARITH. Trx. ID: 178314949354277, APV: 380602."
  // ─────────────────────────────────────────────────────────────
  const payWayRegex = /([៛$])\s*([\d,]+(?:\.\d+)?)\s+paid by\s+(.+?)\s+\(\*(\d+)\)\s+on\s+(\w{3}\s+\d{1,2}),\s+([\d:]+\s+[AP]M)\s+via\s+ABA\s+(PAY|KHQR)(?:\s+\(([^)]+)\))?\s+at\s+(.+?)\s*\.\s+Trx\.\s*ID:\s*(\d{8,20}),\s*APV:\s*(\d+)/i;
  const payWayMatch = clean.match(payWayRegex);

  if (payWayMatch) {
    const [, amountSymbol, amountStr, senderName, phoneDigits, dateStr, timeStr, paymentType, merchantBank, merchantName, trxId, apv] = payWayMatch;
    const currency = amountSymbol === '៛' || /KHR/i.test(clean) ? 'KHR' : 'USD';
    const merchant = (merchantName || merchantBank || 'N/A').trim();
    return {
      id: trxId,                                        // Trx. ID as primary key
      trxId: trxId,
      apv: apv,
      amount: parseFloat(amountStr.replace(/,/g, '')),
      currency,
      sender: `${senderName.trim()} (*${phoneDigits})`,
      merchant: merchant.trim(),
      date: parsePayWayDateTime(dateStr, timeStr),      // Real extracted date+time
      source: `ABA ${paymentType.toUpperCase()} (Auto-scraped)`,
      claimed: false,
      claimedBy: null,
      claimTime: null
    };
  }

  // ─────────────────────────────────────────────────────────────
  // FORMAT 2: ABA/ACLEDA FT Reference (e.g. 100FT38197949889)
  // ─────────────────────────────────────────────────────────────
  let id = null;

  const ftMatch = clean.match(/\b\d*FT[A-Z0-9]+\b/i);
  if (ftMatch) id = ftMatch[0].toUpperCase().trim();

  // FORMAT 3: KHQR format
  if (!id) {
    const khqrMatch = clean.match(/KHQR[-\s]*\d{8}[-\s]*[A-Z]/i);
    if (khqrMatch) {
      id = khqrMatch[0].toUpperCase().replace(/\s/g, '').replace(/(KHQR)(\d{8})([A-Z])/, '$1-$2-$3');
    }
  }

  // FORMAT 4: Generic Ref / Trx ID label
  if (!id) {
    const refMatch = clean.match(/(?:ref|reference|trx\.?\s*id|transaction\s*id)[^\w\n]*([A-Z0-9-]{8,20})/i);
    if (refMatch) id = refMatch[1].toUpperCase().trim();
  }

  if (!id) return null;

  // Amount & currency
  let amount = 0.0;
  let currency = /៛|KHR/i.test(clean) ? 'KHR' : 'USD';
  const amountMatch = clean.match(/([៛$])\s*([\d,.]+(?:\.\d+)?)|(?:USD|KHR)\s*([\d,.]+(?:\.\d+)?)|([\d,.]+(?:\.\d+)?)\s*(?:USD|KHR)/i);
  if (amountMatch) {
    const rawVal = amountMatch[2] || amountMatch[3] || amountMatch[4];
    amount = parseFloat(rawVal.replace(/,/g, '')) || 0.0;
    if (amountMatch[1] === '៛' || clean.toUpperCase().includes('KHR')) currency = 'KHR';
    else if (amountMatch[1] === '$' || clean.toUpperCase().includes('USD')) currency = 'USD';
  }

  // Sender
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

// ==========================================================
// CORE VERIFICATION LOGIC
// ==========================================
function verifyTransaction(scannedReceipt, source = 'Simulation') {
  stats.totalScans++;
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  
  // scannedReceipt can be a string (transactionId) or an object (from parseReceiptOcrText)
  const transactionId = typeof scannedReceipt === 'string' ? scannedReceipt : (scannedReceipt ? scannedReceipt.id : null);
  const altTrxId = typeof scannedReceipt === 'object' && scannedReceipt ? scannedReceipt.trxId : null;

  let result = {
    timestamp,
    source,
    scannedId: transactionId || 'NOT_FOUND',
    status: 'FRAUD_DETECTED',
    reason: '',
    details: null
  };

  if (!transactionId) {
    result.reason = 'MISSING_ID';
    result.errorDescription = 'No Transaction Reference ID could be extracted from this image.';
    stats.fraudBlockedCount++;
  } else {
    // Search bank DB (checks both primary Reference ID and secondary Trx ID alias)
    const dbRecord = bankDatabase.find(r => 
      r.id.toUpperCase() === transactionId.toUpperCase() || 
      (r.trxId && r.trxId.toUpperCase() === transactionId.toUpperCase()) ||
      (altTrxId && r.id.toUpperCase() === altTrxId.toUpperCase()) ||
      (altTrxId && r.trxId && r.trxId.toUpperCase() === altTrxId.toUpperCase())
    );

    if (!dbRecord) {
      result.reason = 'UNKNOWN_ID';
      result.errorDescription = `Reference ID ${transactionId} does not exist in secure bank records.`;
      stats.fraudBlockedCount++;
    } else if (dbRecord.claimed) {
      result.reason = 'DUPLICATE';
      result.errorDescription = `Duplicate presentation! ID ${transactionId} was already claimed on ${dbRecord.claimTime} by ${dbRecord.claimedBy}.`;
      stats.fraudBlockedCount++;
      result.details = { ...dbRecord };
    } else if (typeof scannedReceipt === 'object' && scannedReceipt) {
      // Cross-check details (Amount and Currency) to prevent Photoshop fraud
      const amountMismatch = Math.abs(dbRecord.amount - scannedReceipt.amount) > 0.01;
      const currencyMismatch = dbRecord.currency.toUpperCase() !== scannedReceipt.currency.toUpperCase();

      if (amountMismatch || currencyMismatch) {
        result.reason = 'DETAIL_MISMATCH';
        result.errorDescription = `Photoshop Fraud Detected! The receipt claims ${scannedReceipt.amount} ${scannedReceipt.currency}, but the actual bank record lists ${dbRecord.amount} ${dbRecord.currency}.`;
        stats.fraudBlockedCount++;
        result.details = { 
          ...dbRecord, 
          scannedAmount: scannedReceipt.amount, 
          scannedCurrency: scannedReceipt.currency 
        };
      } else {
        // Success
        dbRecord.claimed = true;
        dbRecord.claimTime = timestamp;
        dbRecord.claimedBy = source;

        result.status = 'VERIFIED';
        result.reason = 'SUCCESS';
        result.details = { ...dbRecord };
        stats.verifiedCount++;
        saveBankDatabase();
      }
    } else {
      // Success (fallback when only transactionId string is provided)
      dbRecord.claimed = true;
      dbRecord.claimTime = timestamp;
      dbRecord.claimedBy = source;

      result.status = 'VERIFIED';
      result.reason = 'SUCCESS';
      result.details = { ...dbRecord };
      stats.verifiedCount++;
      saveBankDatabase();
    }
  }

  // Add to ledger history
  ledgerLogs.unshift(result);
  if (ledgerLogs.length > 50) ledgerLogs.pop();

  // Push updates to all connected dashboard instances
  io.emit('dashboard_update', {
    stats,
    latestTransaction: result,
    ledgerLogs,
    bankDatabase
  });

  return result;
}

// ==========================================
// EXPRESS HTTP ROUTING
// ==========================================

// Get initial database & stats
app.get('/api/initial-state', (req, res) => {
  res.json({
    stats,
    ledgerLogs,
    bankDatabase,
    botConfig: {
      botToken: process.env.TELEGRAM_BOT_TOKEN ? 'CONFIGURED' : '',
      chatId: process.env.TELEGRAM_CHAT_ID || '',
      auditBotUsername: process.env.AUDIT_BOT_USERNAME || ''
    }
  });
});

// Reset database state for simulation demo convenience
app.post('/api/reset-db', (req, res) => {
  bankDatabase.forEach(r => {
    r.claimed = false;
    r.claimTime = null;
    r.claimedBy = null;
  });
  saveBankDatabase();
  stats = { totalScans: 0, verifiedCount: 0, fraudBlockedCount: 0 };
  ledgerLogs = [];
  
  io.emit('dashboard_update', {
    stats,
    latestTransaction: null,
    ledgerLogs,
    bankDatabase
  });
  res.json({ success: true });
});

// Endpoint for uploading bank logs via CSV file
app.post('/api/upload-bank-log', upload.single('bankLog'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const csvContent = req.file.buffer.toString('utf-8');
    const lines = csvContent.split(/\r?\n/);
    const newRecords = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Skip header row if it contains headers
      if (i === 0 && (line.toLowerCase().includes('id') || line.toLowerCase().includes('sender'))) {
        continue;
      }

      const parts = line.split(',');
      if (parts.length < 3) continue;

      const id = parts[0].trim();
      const sender = parts[1].trim();
      const amount = parseFloat(parts[2].trim()) || 0.0;
      const currency = (parts[3] || 'USD').trim();
      const date = (parts[4] || new Date().toISOString().replace('T', ' ').substring(0, 19)).trim();

      if (id) {
        newRecords.push({
          id,
          amount,
          currency,
          sender,
          date,
          claimed: false,
          claimedBy: null,
          claimTime: null
        });
      }
    }

    if (newRecords.length === 0) {
      return res.status(400).json({ error: 'No valid records found in CSV file.' });
    }

    // Merge logic: Replace bankDatabase with new records, but preserve claimed states for matching IDs
    const mergedDatabase = newRecords.map(newRec => {
      const existing = bankDatabase.find(oldRec => oldRec.id.toUpperCase() === newRec.id.toUpperCase());
      if (existing && existing.claimed) {
        return { ...newRec, claimed: true, claimedBy: existing.claimedBy, claimTime: existing.claimTime };
      }
      return newRec;
    });

    bankDatabase = mergedDatabase;
    saveBankDatabase();

    // Push updates to all connected dashboards
    io.emit('dashboard_update', {
      stats,
      latestTransaction: null,
      ledgerLogs,
      bankDatabase
    });

    res.json({ success: true, count: bankDatabase.length });
  } catch (err) {
    console.error('Error parsing bank log:', err);
    res.status(500).json({ error: 'Failed to parse CSV file.' });
  }
});


// Helper to save configuration to .env file
function saveEnvConfig(token, chatId, auditBotUsername) {
  try {
    const envPath = path.join(__dirname, '.env');
    let envContent = '';
    envContent += `# ==========================================\n`;
    envContent += `# BAKONGRECON TELEGRAM CONFIGURATION\n`;
    envContent += `# ==========================================\n`;
    
    const finalToken = token || process.env.TELEGRAM_BOT_TOKEN || '';
    const finalChatId = chatId || process.env.TELEGRAM_CHAT_ID || '';
    const finalAuditBot = auditBotUsername || process.env.AUDIT_BOT_USERNAME || '';
    
    envContent += `TELEGRAM_BOT_TOKEN="${finalToken}"\n`;
    envContent += `TELEGRAM_CHAT_ID=${finalChatId}\n`;
    envContent += `AUDIT_BOT_USERNAME="${finalAuditBot}"\n`;
    envContent += `\n# Server configuration\n`;
    envContent += `PORT=${process.env.PORT || 3000}\n`;

    fs.writeFileSync(envPath, envContent, 'utf8');
    console.log('Saved configuration to .env file.');
  } catch (err) {
    console.error('Failed to save .env file:', err);
  }
}

// Update/Save Telegram config
let botInstance = null;
app.post('/api/config-bot', (req, res) => {
  const { token, chatId, auditBotUsername } = req.body;
  
  try {
    if (token) process.env.TELEGRAM_BOT_TOKEN = token;
    if (chatId) process.env.TELEGRAM_CHAT_ID = chatId;
    if (auditBotUsername !== undefined) process.env.AUDIT_BOT_USERNAME = auditBotUsername;

    // Persist to .env
    saveEnvConfig(token, chatId, auditBotUsername);

    if (process.env.TELEGRAM_BOT_TOKEN) {
      initializeTelegramBot(process.env.TELEGRAM_BOT_TOKEN);
    }
    
    res.json({ 
      success: true, 
      botToken: process.env.TELEGRAM_BOT_TOKEN ? 'CONFIGURED' : '', 
      chatId: process.env.TELEGRAM_CHAT_ID || '',
      auditBotUsername: process.env.AUDIT_BOT_USERNAME || ''
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint for simulated canvas upload from client
app.post('/api/verify-upload', upload.single('receipt'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No image uploaded' });
  }

  try {
    // Run OCR via Tesseract
    const ocrResult = await Tesseract.recognize(req.file.buffer, 'eng');
    const ocrText = ocrResult.data.text || '';
    
    // Parse receipt details fully (Ref #, Trx ID, Amount, Currency)
    const parsedReceipt = parseReceiptOcrText(ocrText);
    const transactionId = extractTransactionId(ocrText);
    
    // Run verification against database (prefer the fully parsed receipt object)
    const verificationResult = verifyTransaction(parsedReceipt || transactionId, 'Dashboard Simulation');
    
    res.json(verificationResult);
  } catch (error) {
    console.error('OCR Processing Error:', error);
    res.status(500).json({ error: 'OCR processing failed' });
  }
});

// ==========================================
// TELEGRAM BOT INTEGRATION
// ==========================================
function initializeTelegramBot(token) {
  if (botInstance) {
    console.log('Stopping existing Telegram bot instance...');
    try {
      botInstance.stop();
    } catch (e) {
      console.error(e);
    }
  }

  console.log('Initializing Telegraf bot...');
  const bot = new Telegraf(token);
  botInstance = bot;

  // Bot commands
  bot.start((ctx) => {
    ctx.replyWithHTML(
      '👋 <b>Welcome to Bakong Anti-Fraud Verification Bot!</b>\n\n' +
      'Forward or upload any client payment receipt photo here.\n' +
      'The system will scan it in real-time, cross-check the transaction ID against the bank logs, and alert the AR team immediately.'
    );
  });

  bot.help((ctx) => {
    ctx.reply('Send me an image of a Bakong payment receipt to verify it.');
  });

  // Handle incoming photos
  bot.on('photo', async (ctx) => {
    const fromUser = ctx.from.username ? `@${ctx.from.username}` : `${ctx.from.first_name || 'Sales Rep'}`;
    ctx.reply('📥 Receipt image received. Running anti-fraud security scan...');

    try {
      // Get the highest resolution photo
      const photoArray = ctx.message.photo;
      const fileId = photoArray[photoArray.length - 1].file_id;
      
      // Get download link
      const fileLink = await ctx.telegram.getFileLink(fileId);
      const imageUrl = fileLink.href;

      console.log(`Telegram bot received image from ${fromUser}: ${imageUrl}`);

      // Run OCR using Tesseract for verification.
      const ocrResult = await Tesseract.recognize(imageUrl, 'eng');
      const ocrText = ocrResult.data.text || '';

      const parsedReceipt = parseReceiptOcrText(ocrText);
      const transactionId = parseTelegramTransactionId(ocrText);

      // Verify transaction against mock database (prefer fully parsed receipt object)
      const verResult = verifyTransaction(parsedReceipt || transactionId, `Telegram Bot (${fromUser})`);

      if (verResult.status === 'VERIFIED') {
        const details = verResult.details;
        ctx.replyWithHTML(
          `✅ <b>Payment Confirmed — Safe to Release Goods</b>\n\n` +
          `We checked this receipt against the bank records and everything matches.\n\n` +
          `• <b>Reference No:</b> <code>${details.id}</code>\n` +
          `• <b>Amount:</b> ${details.amount.toLocaleString(undefined, {minimumFractionDigits:2})} ${details.currency}\n` +
          `• <b>Paid by:</b> ${details.sender}\n` +
          `• <b>Bank Status:</b> ✅ Found in bank records\n\n` +
          `This payment is now marked as <b>claimed</b>. The AR dashboard has been updated.`
        );
      } else {
        let warningMessage = '';
        if (verResult.reason === 'DUPLICATE') {
          const details = verResult.details;
          warningMessage =
            `🚨 <b>STOP — Do NOT release goods!</b>\n\n` +
            `<b>Reason: This receipt has already been used before.</b>\n\n` +
            `Someone submitted the same payment screenshot twice. This is a common scam where a buyer reuses an old receipt to collect goods a second time without paying again.\n\n` +
            `• <b>Receipt Reference No:</b> <code>${verResult.scannedId}</code>\n` +
            `• <b>Original Buyer:</b> ${details.sender}\n` +
            `• <b>Amount on Receipt:</b> ${details.amount.toLocaleString(undefined, {minimumFractionDigits:2})} ${details.currency}\n` +
            `• <b>First used on:</b> ${dbFormatTime(details.claimTime)}\n` +
            `• <b>First submitted by:</b> ${details.claimedBy}\n\n` +
            `👉 <i>Hold the order. Contact your manager and confirm with the bank directly before proceeding.</i>`;
        } else if (verResult.reason === 'DETAIL_MISMATCH') {
          const details = verResult.details;
          warningMessage =
            `🚨 <b>STOP — Photoshop Fraud Detected!</b>\n\n` +
            `<b>Reason: The receipt details do not match the official bank record.</b>\n\n` +
            `The submitted receipt photo claims a payment of <b>${details.scannedAmount.toLocaleString(undefined, {minimumFractionDigits:2})} ${details.scannedCurrency}</b>, but our bank database shows the actual transaction was for <b>${details.amount.toLocaleString(undefined, {minimumFractionDigits:2})} ${details.currency}</b>.\n\n` +
            `• <b>Reference No:</b> <code>${details.id}</code>\n` +
            `• <b>Actual Buyer:</b> ${details.sender}\n` +
            `• <b>Actual Amount:</b> ${details.amount.toLocaleString(undefined, {minimumFractionDigits:2})} ${details.currency}\n\n` +
            `👉 <i>This is a high-risk fraud attempt. Hold the order and contact management immediately.</i>`;
        } else if (verResult.reason === 'UNKNOWN_ID') {
          warningMessage =
            `🚨 <b>STOP — Do NOT release goods!</b>\n\n` +
            `<b>Reason: This receipt does not exist in our bank records.</b>\n\n` +
            `We searched our secure bank database and could not find any payment with this reference number. The screenshot may have been created or edited using Photoshop or another tool.\n\n` +
            `• <b>Reference No on Screenshot:</b> <code>${verResult.scannedId}</code>\n` +
            `• <b>Bank Match:</b> ❌ Not found\n\n` +
            `👉 <i>Do not hand over any goods. Report this to your manager immediately. The AR team has been notified.</i>`;
        } else {
          warningMessage =
            `⚠️ <b>Could not read the receipt clearly.</b>\n\n` +
            `Our system was unable to find a valid reference number in the image you sent. This can happen if the photo is blurry, cropped, or partially blocked.\n\n` +
            `👉 <i>Please take a clearer photo of the full payment screenshot and send it again. Make sure the Reference No or Trx. ID is fully visible.</i>`;
        }

        ctx.replyWithHTML(warningMessage);

        // Optional: Send emergency alert to group chat if Chat ID is configured
        const targetChatId = process.env.TELEGRAM_CHAT_ID;
        if (targetChatId) {
          try {
            await ctx.telegram.sendMessage(
              targetChatId,
              `🚨 <b>[AR TEAM ALERT] Fraud Attempt Blocked</b>\n\n` +
              `A suspicious payment screenshot was just submitted and has been automatically rejected.\n\n` +
              `• <b>Submitted by:</b> ${fromUser}\n` +
              `• <b>Reference No:</b> <code>${verResult.scannedId}</code>\n` +
              `• <b>Problem:</b> ${
                verResult.reason === 'DUPLICATE' ? 'This receipt was already used before (Duplicate scam)' : 
                verResult.reason === 'DETAIL_MISMATCH' ? 'Amount or Currency mismatch (Photoshop/Editing fraud attempt)' :
                verResult.reason === 'UNKNOWN_ID' ? 'This reference number does not exist in the bank records (Possibly faked)' : 
                'The system could not read a valid reference number from the image'
              }\n\n` +
              `⛔ <b>Action required: Do not release goods. Verify with the bank directly and report to management.</b>`
              , { parse_mode: 'HTML' }
            );
          } catch (chatErr) {
            console.error('Failed to send telegram group notification:', chatErr.message);
          }
        }
      }
    } catch (err) {
      console.error('Telegram Bot processing error:', err);
      ctx.reply('❌ Error scanning receipt image. Please ensure it is a clear image.');
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // Handle incoming text — bank notification scraper + PayWay scraper
  // ─────────────────────────────────────────────────────────────────
  bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    const chatType = ctx.chat.type;  // 'private' | 'group' | 'supergroup'
    const fromUser = ctx.from.username ? `@${ctx.from.username}` : `${ctx.from.first_name || 'User'}`;
    const fromId = String(ctx.from.id);
    const isGroup = chatType === 'group' || chatType === 'supergroup';

    // 1. Scrape only from the configured group Chat ID if it's a group message
    const targetChatId = process.env.TELEGRAM_CHAT_ID;
    if (isGroup && targetChatId && String(ctx.chat.id) !== String(targetChatId)) {
      console.log(`[Telegram Scraper] Ignored text in unconfigured group chat: ${ctx.chat.id}`);
      return;
    }

    const parsed = parseBankNotification(text);

    if (parsed) {
      // 2. If it's a group message, we MUST verify that the sender is the trusted auditbot
      if (isGroup) {
        const expectedAuditBotUsername = process.env.AUDIT_BOT_USERNAME || 'auditbot';
        const isAuditBot = verifyAuditBotSender(ctx.from, expectedAuditBotUsername);

        if (!isAuditBot) {
          const warningMsg = `Blocked potential bank log spoofing attempt in group chat ${ctx.chat.id} from user ${fromUser}. (Sender is not the trusted AuditBot)`;
          console.warn(`[Telegram Scraper] ⚠️ ${warningMsg}`);
          
          const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
          ledgerLogs.unshift({
            timestamp,
            source: `Telegram Group (${fromUser})`,
            scannedId: parsed.id || 'N/A',
            status: 'FRAUD_DETECTED',
            reason: 'SPOOFED_BANK_NOTIFICATION',
            errorDescription: `Attempted to inject fake bank notification for transaction ${parsed.id} of ${parsed.amount} ${parsed.currency}.`
          });
          if (ledgerLogs.length > 50) ledgerLogs.pop();
          
          io.emit('dashboard_update', { stats, latestTransaction: null, ledgerLogs, bankDatabase });
          return;
        }
      }

      const existingIdx = bankDatabase.findIndex(
        r => r.id.toUpperCase() === parsed.id.toUpperCase() || (r.trxId && r.trxId.toUpperCase() === parsed.trxId.toUpperCase())
      );

      parsed.sourceChatId = String(ctx.chat.id);
      parsed.sourceMessageId = String(ctx.message.message_id);
      parsed.sourceUsername = ctx.from.username ? `@${ctx.from.username}` : null;
      parsed.sourceChatType = chatType;

      if (existingIdx === -1) {
        bankDatabase.push(parsed);
        saveBankDatabase();

        io.emit('dashboard_update', { stats, latestTransaction: null, ledgerLogs, bankDatabase });
        io.emit('bank_scraped', parsed);

        console.log(`[Telegram Scraper] ✅ Added: Ref/Trx=${parsed.id}, Amount=${parsed.amount} ${parsed.currency}, Sender=${parsed.sender}, Date=${parsed.date}`);

        if (!isGroup) {
          ctx.replyWithHTML(
            `📥 <b>Bank Ledger Auto-Updated</b>\n\n` +
            `A Telegram bank notification was detected and automatically added to the bank database.\n\n` +
            `• <b>Reference / Trx ID:</b> <code>${parsed.id}</code>\n` +
            `• <b>APV:</b> ${parsed.apv || 'N/A'}\n` +
            `• <b>Amount:</b> ${parsed.currency === 'KHR' ? '៛' : '$'}${parsed.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
            `• <b>Paid by:</b> ${parsed.sender}\n` +
            `• <b>Merchant:</b> ${parsed.merchant || 'N/A'}\n` +
            `• <b>Date / Time:</b> ${parsed.date}\n` +
            `• <b>Status:</b> 🟢 UNCLAIMED (waiting for receipt scan)`
          );
        }
      } else if (!isGroup) {
        const existing = bankDatabase[existingIdx];
        ctx.replyWithHTML(
          `ℹ️ <b>Already in Bank Records</b>\n\n` +
          `Reference / Trx ID <code>${parsed.id}</code> is already logged.\n` +
          `• Status: ${existing.claimed ? '🔴 CLAIMED' : '🟢 UNCLAIMED'}`
        );
      }

      return;
    }

    if (!isGroup) {
      ctx.reply('To verify a receipt, send me a photo. To add a bank transaction, forward an ABA PAY or ABA KHQR notification message here.');
    }
  });

  bot.launch()
    .then(() => {
      console.log('Telegram Bot successfully launched.');
      io.emit('bot_status', { status: 'RUNNING' });
    })
    .catch((err) => {
      console.error('Telegram Bot launch failed:', err.message);
      io.emit('bot_status', { status: 'ERROR', error: err.message });
    });
}

function dbFormatTime(timeStr) {
  if (!timeStr) return '';
  return timeStr;
}

// Automatically boot Telegram bot if token is already in .env
if (process.env.TELEGRAM_BOT_TOKEN) {
  initializeTelegramBot(process.env.TELEGRAM_BOT_TOKEN);
}

// ==========================================
// SOCKET.IO EVENT HANDLING
// ==========================================
io.on('connection', (socket) => {
  console.log('Dashboard client connected:', socket.id);
  
  // Send current state to newly connected client
  socket.emit('dashboard_update', {
    stats,
    latestTransaction: null,
    ledgerLogs,
    bankDatabase
  });

  socket.emit('bot_status', { 
    status: botInstance ? 'RUNNING' : 'STOPPED',
    tokenConfigured: !!process.env.TELEGRAM_BOT_TOKEN
  });

  socket.on('disconnect', () => {
    console.log('Dashboard client disconnected:', socket.id);
  });
});

// Start Server
server.listen(PORT, () => {
  console.log(`BakongRecon server running on http://localhost:${PORT}`);
});
