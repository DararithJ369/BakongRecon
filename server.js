require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const Tesseract = require('tesseract.js');
const { Telegraf } = require('telegraf');
const fs = require('fs');
const path = require('path');

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
  const cleanText = text.replace(/\s+/g, ' ');

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
  // Usually "Trx. ID" or "Trx ID" followed by 10-13 digits
  const trxPattern = /(?:trx\.?\s*id|transaction\s*id)[^\w\n]*(\d{10,13})/i;
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
  const refPattern = /(?:txn|ref|reference|trace|id)[^0-9\n]*(\d{8,12})/i;
  const matchRef = text.match(refPattern);
  if (matchRef) {
    return matchRef[1].trim();
  }

  // Pattern 5: Any raw sequence of 8-12 numbers
  const numberPattern = /\b\d{8,12}\b/;
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
  // FORMAT 1: PayWay by ABA bot
  // Example: "$100 paid by LY LAISRUN (*964) on Jul 04, 02:14 PM via ABA PAY at KIM PUTDARARITH. Trx. ID: 178314927151090, APV: 444368."
  // ─────────────────────────────────────────────────────────────
  const payWayRegex = /\$(\d+(?:\.\d+)?)\s+paid by\s+([A-Z][A-Z\s]+?)\s+\(\*(\d+)\)\s+on\s+(\w{3}\s+\d{1,2}),\s+([\d:]+\s+[AP]M)\s+via\s+ABA PAY\s+at\s+([A-Z][A-Z\s]+?)\s*\.\s+Trx\.\s*ID:\s*(\d+),\s*APV:\s*(\d+)/i;
  const payWayMatch = clean.match(payWayRegex);

  if (payWayMatch) {
    const [, amountStr, senderName, phoneDigits, dateStr, timeStr, merchant, trxId, apv] = payWayMatch;
    return {
      id: trxId,                                        // Trx. ID as primary key
      trxId: trxId,
      apv: apv,
      amount: parseFloat(amountStr),
      currency: 'USD',
      sender: `${senderName.trim()} (*${phoneDigits})`,
      merchant: merchant.trim(),
      date: parsePayWayDateTime(dateStr, timeStr),      // Real extracted date+time
      source: 'PayWay by ABA (Auto-scraped)',
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
    const refMatch = clean.match(/(?:ref|reference|trx\.?\s*id|transaction\s*id)[^\w\n]*([A-Z0-9-]+)/i);
    if (refMatch) id = refMatch[1].toUpperCase().trim();
  }

  if (!id) return null;

  // Amount & currency
  let amount = 0.0;
  let currency = 'USD';
  const amountMatch = clean.match(/(?:USD|KHR|\$)\s*([\d,.]+)|([\d,.]+)\s*(?:USD|KHR)/i);
  if (amountMatch) {
    const rawVal = amountMatch[1] || amountMatch[2];
    amount = parseFloat(rawVal.replace(/,/g, '')) || 0.0;
    if (clean.toUpperCase().includes('KHR')) currency = 'KHR';
    else if (clean.includes('$') || clean.toUpperCase().includes('USD')) currency = 'USD';
  }

  // Sender
  let sender = 'Unknown Sender';
  const senderMatch = clean.match(/from\s+(?:account\s+)?([A-Z\s]{3,30})(?:\s*\(|\s*\.|\s*Ref|\s*Date|\s*Transaction)/i);
  if (senderMatch) {
    sender = senderMatch[1].trim();
  } else {
    const simpleSenderMatch = clean.match(/from\s+([A-Z\s]{3,20})/i);
    if (simpleSenderMatch) sender = simpleSenderMatch[1].trim();
  }

  return {
    id,
    trxId: id,
    amount,
    currency,
    sender,
    date: new Date().toISOString().replace('T', ' ').substring(0, 19),
    source: 'Manual/Forward',
    claimed: false,
    claimedBy: null,
    claimTime: null
  };
}

// ==========================================================
// CORE VERIFICATION LOGIC
// ==========================================
function verifyTransaction(transactionId, source = 'Simulation') {
  stats.totalScans++;
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  
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
      (r.trxId && r.trxId.toUpperCase() === transactionId.toUpperCase())
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
    } else {
      // Success: Verify & Claim it
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
      chatId: process.env.TELEGRAM_CHAT_ID || ''
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


// Update/Save Telegram config
let botInstance = null;
app.post('/api/config-bot', (req, res) => {
  const { token, chatId } = req.body;
  
  try {
    if (token) {
      // Save in memory and optionally write to .env
      process.env.TELEGRAM_BOT_TOKEN = token;
      if (chatId) process.env.TELEGRAM_CHAT_ID = chatId;

      initializeTelegramBot(token);
    }
    res.json({ 
      success: true, 
      botToken: token ? 'CONFIGURED' : '', 
      chatId: chatId || '' 
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
    const transactionId = extractTransactionId(ocrResult.data.text);
    
    // Run verification against database
    const verificationResult = verifyTransaction(transactionId, 'Dashboard Simulation');
    
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

      // Run OCR using Tesseract (recognize can load URLs!)
      const ocrResult = await Tesseract.recognize(imageUrl, 'eng');
      const transactionId = extractTransactionId(ocrResult.data.text);

      // Verify transaction against mock database
      const verResult = verifyTransaction(transactionId, `Telegram Bot (${fromUser})`);

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
              `• <b>Problem:</b> ${verResult.reason === 'DUPLICATE' ? 'This receipt was already used before (Duplicate scam)' : verResult.reason === 'UNKNOWN_ID' ? 'This reference number does not exist in the bank records (Possibly faked)' : 'The system could not read a valid reference number from the image'}\n\n` +
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

    // ── PAYWAY BY ABA AUTO-SCRAPE DETECTION ──────────────────────
    // Matches "$X paid by NAME (*XXXX) on Mon DD, HH:MM AM via ABA PAY at MERCHANT. Trx. ID: ...."
    const isPayWay = /paid by .+ on \w{3} \d{1,2},\s*\d{1,2}:\d{2}\s*[AP]M via ABA PAY/i.test(text);

    if (isPayWay) {
      const parsed = parseBankNotification(text);
      if (parsed) {
        const existingIdx = bankDatabase.findIndex(
          r => r.id === parsed.id || r.trxId === parsed.trxId
        );

        if (existingIdx === -1) {
          // New record — add to database
          bankDatabase.push(parsed);
          saveBankDatabase();

          // Broadcast to dashboard
          io.emit('dashboard_update', { stats, latestTransaction: null, ledgerLogs, bankDatabase });
          io.emit('bank_scraped', parsed);

          console.log(`[PayWay Scraper] ✅ Added: Trx.ID=${parsed.trxId}, Amount=$${parsed.amount}, Sender=${parsed.sender}, Date=${parsed.date}`);

          // Only reply in private chats — stay silent in groups to avoid spam
          if (!isGroup) {
            ctx.replyWithHTML(
              `📥 <b>Bank Ledger Auto-Updated</b>\n\n` +
              `A PayWay by ABA payment notification was detected and automatically added to the bank database.\n\n` +
              `• <b>Trx. ID:</b> <code>${parsed.trxId}</code>\n` +
              `• <b>APV:</b> ${parsed.apv || 'N/A'}\n` +
              `• <b>Amount:</b> $${parsed.amount.toFixed(2)}\n` +
              `• <b>Paid by:</b> ${parsed.sender}\n` +
              `• <b>Merchant:</b> ${parsed.merchant || 'N/A'}\n` +
              `• <b>Date / Time:</b> ${parsed.date}\n` +
              `• <b>Status:</b> 🟢 UNCLAIMED (waiting for receipt scan)`
            );
          }
        } else {
          // Duplicate — already in DB, skip silently in groups
          if (!isGroup) {
            ctx.replyWithHTML(
              `ℹ️ <b>Already in Bank Records</b>\n\n` +
              `Trx. ID <code>${parsed.trxId}</code> is already logged.\n` +
              `• Status: ${bankDatabase[existingIdx].claimed ? '🔴 CLAIMED' : '🟢 UNCLAIMED'}`
            );
          }
        }
      }
      return; // Don't fall through to generic handler
    }

    // ── GENERIC NOTIFICATION TEXT (forwarded bank alerts, etc.) ──
    const isNotification = text.toLowerCase().includes('received') ||
                           text.toLowerCase().includes('transfer') ||
                           text.toLowerCase().includes('ref') ||
                           text.toLowerCase().includes('trx');

    if (isNotification && !isGroup) {
      const parsed = parseBankNotification(text);
      if (parsed) {
        const existing = bankDatabase.find(r => r.id.toUpperCase() === parsed.id.toUpperCase());
        if (existing) {
          ctx.replyWithHTML(
            `ℹ️ <b>Transaction Already Logged</b>\n\n` +
            `• <b>Ref ID:</b> <code>${existing.id}</code>\n` +
            `• <b>Amount:</b> ${existing.amount.toLocaleString(undefined, {minimumFractionDigits:2})} ${existing.currency}\n` +
            `• <b>Status:</b> ${existing.claimed ? '🔴 CLAIMED' : '🟢 UNCLAIMED'}`
          );
        } else {
          bankDatabase.push(parsed);
          saveBankDatabase();
          io.emit('dashboard_update', { stats, latestTransaction: null, ledgerLogs, bankDatabase });
          ctx.replyWithHTML(
            `📥 <b>Bank Ledger Updated</b>\n\n` +
            `• <b>Ref ID:</b> <code>${parsed.id}</code>\n` +
            `• <b>Amount:</b> ${parsed.amount.toLocaleString(undefined, {minimumFractionDigits:2})} ${parsed.currency}\n` +
            `• <b>Sender:</b> ${parsed.sender}\n` +
            `• <b>Date:</b> ${parsed.date}\n` +
            `• <b>Status:</b> 🟢 UNCLAIMED (awaiting sales rep screenshot scan)`
          );
        }
      } else {
        ctx.reply('❓ I detected a bank notification pattern, but could not read the transaction ID or amount. Please check the format.');
      }
    } else if (!isGroup) {
      ctx.reply('To verify a receipt, send me a photo. To add a bank transaction, forward a PayWay by ABA notification message here.');
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
