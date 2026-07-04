// ==========================================
// SOCKET.IO & CONNECTION MANAGEMENT
// ==========================================
const socket = io();

const socketStatusEl = document.getElementById('socket-status');
const botStatusEl = document.getElementById('bot-status-indicator');
const currentTimeEl = document.getElementById('current-time');

// Update Clock
setInterval(() => {
  const now = new Date();
  currentTimeEl.textContent = now.toTimeString().split(' ')[0];
}, 1000);

socket.on('connect', () => {
  socketStatusEl.textContent = 'ONLINE';
  socketStatusEl.className = 'val connected font-mono';
});

socket.on('disconnect', () => {
  socketStatusEl.textContent = 'OFFLINE';
  socketStatusEl.className = 'val disconnected font-mono';
});

socket.on('bot_status', (data) => {
  if (data.status === 'RUNNING') {
    botStatusEl.textContent = 'RUNNING';
    botStatusEl.className = 'val connected font-mono';
  } else if (data.status === 'ERROR') {
    botStatusEl.textContent = 'ERROR';
    botStatusEl.className = 'val disconnected font-mono';
    console.error('Telegram bot error:', data.error);
  } else {
    botStatusEl.textContent = 'STOPPED';
    botStatusEl.className = 'val font-mono';
  }
});

// ==========================================
// AUDIO SYNTHESIZER (WEB AUDIO API)
// ==========================================
class SoundManager {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  // Double high-security beep for success
  playSuccess() {
    this.init();
    const now = this.ctx.currentTime;
    
    // First beep
    const osc1 = this.ctx.createOscillator();
    const gain1 = this.ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(800, now);
    gain1.gain.setValueAtTime(0, now);
    gain1.gain.linearRampToValueAtTime(0.1, now + 0.05);
    gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.25);
    
    osc1.connect(gain1);
    gain1.connect(this.ctx.destination);
    
    osc1.start(now);
    osc1.stop(now + 0.25);

    // Second beep (slightly higher pitch)
    const osc2 = this.ctx.createOscillator();
    const gain2 = this.ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1200, now + 0.1);
    gain2.gain.setValueAtTime(0, now + 0.1);
    gain2.gain.linearRampToValueAtTime(0.1, now + 0.15);
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    
    osc2.connect(gain2);
    gain2.connect(this.ctx.destination);
    
    osc2.start(now + 0.1);
    osc2.stop(now + 0.35);
  }

  // Rising/falling high-frequency alert for fraud
  playAlert() {
    this.init();
    const now = this.ctx.currentTime;
    const duration = 1.0;
    
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, now);
    // Sweeping siren sound
    osc.frequency.linearRampToValueAtTime(800, now + 0.25);
    osc.frequency.linearRampToValueAtTime(300, now + 0.5);
    osc.frequency.linearRampToValueAtTime(800, now + 0.75);
    osc.frequency.linearRampToValueAtTime(300, now + 1.0);
    
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.15, now + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    
    // Add low-pass filter to make it sound slightly crunchy
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1200, now);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    
    osc.start(now);
    osc.stop(now + duration);
  }
}

const sounds = new SoundManager();

// ==========================================
// RECEIPT CANVAS SIMULATOR
// ==========================================
const canvas = document.getElementById('receipt-canvas');
const ctx = canvas.getContext('2d');

function generateReceiptImage(type) {
  // Check if it's an ABA style template
  const isAba = type.startsWith('aba');

  if (isAba) {
    // ----------------------------------------
    // DRAW ABA BANK RECEIPT
    // ----------------------------------------
    // Clear canvas with white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw top blue round icon
    ctx.fillStyle = '#095290'; // ABA Blue
    ctx.beginPath();
    ctx.arc(canvas.width / 2, 45, 20, 0, Math.PI * 2);
    ctx.fill();

    // Draw shop symbol inside the blue circle
    ctx.fillStyle = '#ffffff';
    ctx.font = '14px Inter';
    ctx.textAlign = 'center';
    ctx.fillText('🏪', canvas.width / 2, 50);

    // Set values based on type
    let trxId = '56868300340';
    let refNo = '100FT38197949889';
    let amountText = '-12,623.52 KHR';
    let sender = 'LY LAISRUN (011 624 964)';
    let dateText = 'Jul 04, 2026 06:46 AM';

    if (type === 'aba_duplicate') {
      trxId = '56868300340';
      refNo = '100FT38197949889';
      amountText = '-12,623.52 KHR';
    }

    // Amount text (Large, dark gray)
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 18px Inter';
    ctx.fillText(amountText, canvas.width / 2, 95);

    // Seller subtext
    ctx.fillStyle = '#64748b';
    ctx.font = 'bold 9px Inter';
    ctx.fillText('TOTAL SEN SOK 2 A', canvas.width / 2, 110);

    // Dotted separator line
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(15, 125);
    ctx.lineTo(canvas.width - 15, 125);
    ctx.stroke();
    ctx.setLineDash([]); // Reset line dash

    // Setup fields drawing
    const fields = [
      { label: 'Trx. ID:', value: trxId },
      { label: 'APV:', value: '671875' },
      { label: 'From account:', value: sender },
      { label: 'Original amount:', value: '12,623.52 KHR' },
      { label: 'Purchase #:', value: '178312239334854' },
      { label: 'Reference #:', value: refNo },
      { label: 'Seller:', value: 'TOTAL SEN SOK 2 A' },
      { label: 'Transaction date:', value: dateText }
    ];

    let startY = 150;
    const lineSpacing = 24;

    fields.forEach(field => {
      // Draw Label (Left align)
      ctx.textAlign = 'left';
      ctx.fillStyle = '#64748b';
      ctx.font = '9px Inter';
      ctx.fillText(field.label, 20, startY);

      // Draw Value (Right align)
      ctx.textAlign = 'right';
      ctx.fillStyle = '#0f172a';
      // Use monospaced or bold font for crucial ID fields so OCR reads them perfectly
      if (field.label.includes('Ref') || field.label.includes('Trx')) {
        ctx.font = 'bold 10px Courier Prime';
      } else {
        ctx.font = 'bold 9px Inter';
      }
      ctx.fillText(field.value, canvas.width - 20, startY);

      startY += lineSpacing;
    });

    // Draw Dotted line at bottom
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(15, 355);
    ctx.lineTo(canvas.width - 15, 355);
    ctx.stroke();
    ctx.setLineDash([]);

    // Draw ABA BANK logo at bottom
    ctx.fillStyle = '#095290';
    ctx.font = 'bold 12px Inter';
    ctx.textAlign = 'left';
    ctx.fillText("ABA' BANK", 40, 385);

    // Draw red square block logo next to text
    ctx.fillStyle = '#e11d48';
    ctx.fillRect(115, 375, 10, 10);

    ctx.fillStyle = '#64748b';
    ctx.font = '6px Inter';
    ctx.fillText('NATIONAL BANK', 130, 379);
    ctx.fillText('OF CANADA GROUP', 130, 385);

  } else {
    // ----------------------------------------
    // DRAW BAKONG KHQR RECEIPT
    // ----------------------------------------
    // Clear canvas
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw Bakong Teal header/gradient
    const grad = ctx.createLinearGradient(0, 0, 0, 110);
    grad.addColorStop(0, '#0097a7'); // Acleda / Bakong teal
    grad.addColorStop(1, '#006064');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, 110);

    // Draw Bakong Ring Logo
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(canvas.width / 2, 45, 20, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px Inter';
    ctx.textAlign = 'center';
    ctx.fillText('BAKONG', canvas.width / 2, 78);
    ctx.font = '7px Orbitron';
    ctx.fillText('SECURE KHQR PAYMENT', canvas.width / 2, 92);

    // Card Content background
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(15, 125, canvas.width - 30, canvas.height - 145);

    // Receipt details based on type
    let txnId = '';
    let amount = '$120.00';
    let sender = 'Sokha Lim';
    let dateText = '2026-07-04 10:23:45';

    if (type === 'valid' || type === 'duplicate') {
      txnId = 'KHQR-98327491-B';
      amount = '$120.00';
      sender = 'Sokha Lim';
      dateText = '2026-07-04 10:23:45';
    } else if (type === 'fake') {
      txnId = 'KHQR-99999999-X';
      amount = '$99.99';
      sender = 'Jack (Scammer)';
      dateText = '2026-07-04 13:10:02';
    } else if (type === 'ocr_fail') {
      txnId = ''; // Omit
      amount = '$15.00';
      sender = 'Unknown Rep';
      dateText = '2026-07-04 13:12:15';
    }

    // Draw details text
    ctx.textAlign = 'left';
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px Inter';

    // Amount Section
    ctx.fillText('AMOUNT RECEIVED', 30, 160);
    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 22px Orbitron';
    ctx.fillText(amount, 30, 185);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px Inter';
    
    // Sender info
    ctx.fillText('SENDER', 30, 220);
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 12px Inter';
    ctx.fillText(sender, 30, 235);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px Inter';

    // Date info
    ctx.fillText('TIMESTAMP', 30, 270);
    ctx.fillStyle = '#f8fafc';
    ctx.font = '11px Courier Prime';
    ctx.fillText(dateText, 30, 285);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px Inter';

    // Transaction ID (THE KEY FIELD)
    ctx.fillText('TRANSACTION REFERENCE ID', 30, 320);
    
    if (type === 'ocr_fail') {
      ctx.fillStyle = '#ef4444';
      ctx.font = 'italic 10px Inter';
      ctx.fillText('||||||| CORRUPTED |||||||', 30, 340);
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(30, 335);
      ctx.lineTo(180, 345);
      ctx.moveTo(35, 345);
      ctx.lineTo(170, 332);
      ctx.stroke();
    } else {
      ctx.fillStyle = '#06b6d4';
      ctx.font = 'bold 12px Orbitron';
      ctx.fillText(txnId, 30, 340);
    }

    // Draw Success Badge Watermark
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.15)';
    ctx.lineWidth = 1;
    ctx.strokeRect(canvas.width - 90, 140, 65, 30);
    ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
    ctx.font = 'bold 8px Orbitron';
    ctx.textAlign = 'center';
    ctx.fillText('SUCCESS', canvas.width - 57, 158);
  }

  return canvas.toDataURL('image/png');
}

// ==========================================
// SIMULATION & IMAGE SCANNER TRIGGERS
// ==========================================
const btnSimulate = document.getElementById('btn-simulate');
const simTypeSelect = document.getElementById('sim-type');
const visualizerScreen = document.getElementById('visualizer-screen');
const imagePreview = document.getElementById('scanned-image-preview');
const placeholderText = document.getElementById('visualizer-placeholder');
const scanIndicatorBadge = document.getElementById('scan-indicator-badge');

btnSimulate.addEventListener('click', () => {
  const type = simTypeSelect.value;
  
  // Initialize sounds context (required for modern browser permissions)
  sounds.init();

  // Reset visualizer states
  placeholderText.style.display = 'none';
  imagePreview.style.display = 'none';
  scanIndicatorBadge.textContent = 'SCANNING...';
  scanIndicatorBadge.style.color = 'var(--color-primary)';
  visualizerScreen.classList.add('scanning');

  // Generate the receipt image on canvas
  const dataUrl = generateReceiptImage(type);
  imagePreview.src = dataUrl;
  imagePreview.style.display = 'block';

  // Convert canvas to blob and upload
  canvas.toBlob((blob) => {
    const formData = new FormData();
    formData.append('receipt', blob, 'screenshot.png');

    // Simulate network delay for scan sensation
    setTimeout(() => {
      fetch('/api/verify-upload', {
        method: 'POST',
        body: formData
      })
      .then(res => res.json())
      .then(result => {
        // Complete visual scanning animation
        visualizerScreen.classList.remove('scanning');
        scanIndicatorBadge.textContent = 'COMPLETED';
        scanIndicatorBadge.style.color = result.status === 'VERIFIED' ? 'var(--color-success)' : 'var(--color-alert)';

        handleVerificationUIFeedback(result);
      })
      .catch(err => {
        console.error('Scan API failed:', err);
        visualizerScreen.classList.remove('scanning');
        scanIndicatorBadge.textContent = 'ERROR';
        scanIndicatorBadge.style.color = 'var(--color-alert)';
      });
    }, 1500); // 1.5 second scanning sensation
  }, 'image/png');
});

// ==========================================
// REAL-TIME DASHBOARD FEEDBACK & SOUND
// ==========================================
const banner = document.getElementById('verification-banner');
const bannerTitle = document.getElementById('banner-title');
const bannerDesc = document.getElementById('banner-desc');
const chatLogEl = document.getElementById('chat-log');

function handleVerificationUIFeedback(result) {
  banner.className = 'verification-banner'; // Clear classes
  
  if (result.status === 'VERIFIED') {
    banner.classList.add('verified');
    bannerTitle.textContent = '✅ Payment Confirmed — Safe to Release Goods';
    const amt = result.details.currency === 'KHR'
      ? `${result.details.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })} KHR`
      : `$${result.details.amount.toFixed(2)} USD`;
    bannerDesc.textContent = `Receipt from ${result.details.sender} for ${amt} matches bank records. Reference: ${result.scannedId}.`;
    
    // Play success beep
    sounds.playSuccess();
  } else {
    banner.classList.add('fraud');

    let reasonText = '';
    let emergencyChatText = '';

    if (result.reason === 'DUPLICATE') {
      bannerTitle.textContent = '🚨 STOP — This receipt was already used!';
      reasonText = `Someone submitted this receipt before. Ref: ${result.scannedId} was already claimed by ${result.details.claimedBy}. Do NOT release goods — hold the order and contact your manager.`;
      emergencyChatText = `🚨 [DUPLICATE SCAM BLOCKED] A sales rep submitted a receipt that was already used. Ref No: ${result.scannedId}. Original buyer: ${result.details.sender}. DO NOT release goods. Hold the order and verify with the bank.`;
    } else if (result.reason === 'UNKNOWN_ID') {
      bannerTitle.textContent = '🚨 STOP — This receipt is NOT in our bank records!';
      reasonText = `Reference No "${result.scannedId}" was not found in the bank database. This screenshot may be fake or edited. Do NOT release goods — report to your manager immediately.`;
      emergencyChatText = `🚨 [FAKE RECEIPT BLOCKED] A payment screenshot was submitted with a reference number that does not exist in the bank records. Ref No: ${result.scannedId}. Possibly Photoshopped. Do NOT release goods.`;
    } else {
      bannerTitle.textContent = '⚠️ Could not read the receipt — please resend';
      reasonText = `The system could not find a clear reference number in this image. Ask the buyer to resend a full, clear screenshot where the Trx. ID or Reference No is visible.`;
      emergencyChatText = `⚠️ [SCAN FAILED] A receipt image was forwarded but the system could not read the reference number. The image may be blurry or cropped. Ask for a clearer photo before releasing any goods.`;
    }

    bannerDesc.textContent = reasonText;
    
    // Play emergency siren
    sounds.playAlert();

    // Trigger automated emergency text notification in dashboard chat widget
    triggerEmergencyChatAlert(result.timestamp, result.source, emergencyChatText);
  }
}

function triggerEmergencyChatAlert(timestamp, source, text) {
  // Check if system message placeholder is still there
  const systemMsg = chatLogEl.querySelector('.chat-system-msg');
  if (systemMsg) systemMsg.remove();

  const formattedTime = timestamp.split(' ')[1] || timestamp;
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  bubble.innerHTML = `
    <span class="timestamp">[${formattedTime}]</span>
    <span class="sender">AR ALARM:</span>
    <span class="message">${text}</span>
  `;

  chatLogEl.insertBefore(bubble, chatLogEl.firstChild);
  
  // Keep logs tidy
  if (chatLogEl.children.length > 20) {
    chatLogEl.removeChild(chatLogEl.lastChild);
  }
}

// ==========================================
// LEDGER STREAM UPDATES & STATS
// ==========================================
const ledgerList = document.getElementById('ledger-list');
const statTotal = document.getElementById('stat-total');
const statVerified = document.getElementById('stat-verified');
const statBlocked = document.getElementById('stat-blocked');
const gaugeFill = document.getElementById('gauge-fill');
const gaugePercent = document.getElementById('gauge-percent');
const bankDbBody = document.getElementById('bank-db-body');

socket.on('dashboard_update', (data) => {
  // Update Stats
  statTotal.textContent = data.stats.totalScans;
  statVerified.textContent = data.stats.verifiedCount;
  statBlocked.textContent = data.stats.fraudBlockedCount;

  // Update Integrity Gauge
  let integrity = 100;
  if (data.stats.totalScans > 0) {
    integrity = Math.round((data.stats.verifiedCount / data.stats.totalScans) * 100);
  }
  gaugeFill.style.width = `${integrity}%`;
  gaugePercent.textContent = `${integrity}%`;
  
  // Update gauge color based on stats
  if (integrity < 70) {
    gaugeFill.style.backgroundColor = 'var(--color-alert)';
    gaugePercent.style.color = 'var(--color-alert)';
  } else if (integrity < 90) {
    gaugeFill.style.backgroundColor = 'var(--color-warning)';
    gaugePercent.style.color = 'var(--color-warning)';
  } else {
    gaugeFill.style.backgroundColor = 'var(--color-success)';
    gaugePercent.style.color = 'var(--color-success)';
  }

  // Update Live Ledger Stream
  renderLedgerList(data.ledgerLogs);

  // Update Bank Database view
  renderBankDatabase(data.bankDatabase);

  // If a transaction arrived in real-time from the real Telegram bot (source contains Telegram)
  // and wasn't started by this local dashboard scan, we should trigger UI banner feedback!
  if (data.latestTransaction && data.latestTransaction.source.includes('Telegram')) {
    handleVerificationUIFeedback(data.latestTransaction);
  }
});

function renderLedgerList(logs) {
  if (!logs || logs.length === 0) {
    ledgerList.innerHTML = '<div class="ledger-empty">No transactions scanned in this session.</div>';
    return;
  }

  ledgerList.innerHTML = '';
  logs.forEach(log => {
    const row = document.createElement('div');
    row.className = 'ledger-row';
    
    // Extracted clean timestamp
    const displayTime = log.timestamp.split(' ')[1] || log.timestamp;
    
    const isVerified = log.status === 'VERIFIED';
    const badgeClass = isVerified ? 'verified' : 'fraud';
    const badgeText = isVerified ? '✅ VERIFIED' : '🚨 FRAUD';

    row.innerHTML = `
      <span class="time font-mono">${displayTime}</span>
      <span class="source">${log.source}</span>
      <span class="id font-mono">${log.scannedId}</span>
      <span class="badge ${badgeClass}">${badgeText}</span>
    `;
    ledgerList.appendChild(row);
  });
}

function renderBankDatabase(db) {
  bankDbBody.innerHTML = '';
  db.forEach(record => {
    const tr = document.createElement('tr');
    if (record.claimed) {
      tr.className = 'claimed-row';
    }
    
    const statusText = record.claimed ? 'CLAIMED' : 'UNCLAIMED';
    const displayAmount = record.currency === 'KHR'
      ? `${record.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} KHR`
      : `$${record.amount.toFixed(2)} USD`;
    
    tr.innerHTML = `
      <td><span class="db-id font-mono">${record.id}</span></td>
      <td><span class="db-id font-mono" style="color: var(--text-muted);">${record.trxId || '-'}</span></td>
      <td>${record.sender}</td>
      <td><span class="db-amount font-mono">${displayAmount}</span></td>
      <td><span class="db-status-dot">${statusText}</span></td>
    `;
    bankDbBody.appendChild(tr);
  });
}

// ==========================================
// INITIAL STATE LOAD & FORM ACTIONS
// ==========================================

// Load initial details from server on boot
fetch('/api/initial-state')
  .then(res => res.json())
  .then(data => {
    // Update dashboard metrics
    statTotal.textContent = data.stats.totalScans;
    statVerified.textContent = data.stats.verifiedCount;
    statBlocked.textContent = data.stats.fraudBlockedCount;
    
    // Fill credentials forms if they were loaded
    if (data.botConfig) {
      if (data.botConfig.botToken === 'CONFIGURED') {
        document.getElementById('bot-token').placeholder = 'Token is saved & active';
      }
      document.getElementById('chat-id').value = data.botConfig.chatId;
    }
    
    renderLedgerList(data.ledgerLogs);
    renderBankDatabase(data.bankDatabase);
  });

// Settings Save Telegram credentials
const btnSaveBot = document.getElementById('btn-save-bot');
const botTokenInput = document.getElementById('bot-token');
const chatIdInput = document.getElementById('chat-id');

btnSaveBot.addEventListener('click', () => {
  const token = botTokenInput.value.trim();
  const chatId = chatIdInput.value.trim();

  if (!token && !document.getElementById('bot-token').placeholder.includes('saved')) {
    alert('Please enter a Telegram Bot Token.');
    return;
  }

  btnSaveBot.textContent = 'CONNECTING BOT...';
  
  fetch('/api/config-bot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, chatId })
  })
  .then(res => res.json())
  .then(data => {
    btnSaveBot.textContent = 'CONNECTED SUCCESS';
    setTimeout(() => {
      btnSaveBot.textContent = 'INITIALIZE REAL BOT';
    }, 2000);
    if (token) {
      botTokenInput.value = '';
      botTokenInput.placeholder = 'Token is saved & active';
    }
  })
  .catch(err => {
    alert('Failed to configure bot: ' + err.message);
    btnSaveBot.textContent = 'INITIALIZE REAL BOT';
  });
});

// Database Reset Trigger
const btnResetDb = document.getElementById('btn-reset-db');
btnResetDb.addEventListener('click', () => {
  if (confirm('Are you sure you want to reset the bank ledger database and verification statistics?')) {
    fetch('/api/reset-db', { method: 'POST' })
      .then(res => res.json())
      .then(() => {
        chatLogEl.innerHTML = '<div class="chat-system-msg">[SYSTEM] Emergency broadcast channel reset. Awaiting new scans.</div>';
        banner.className = 'verification-banner idle';
        bannerTitle.textContent = 'SYSTEM MONITOR STANDBY';
        bannerDesc.textContent = 'Awaiting incoming receipts from the field...';
        
        // Reset Visualizer Preview
        placeholderText.style.display = 'flex';
        imagePreview.style.display = 'none';
        scanIndicatorBadge.textContent = 'IDLE';
        scanIndicatorBadge.style.color = 'var(--text-muted)';
      });
  }
});

// CSV Upload Trigger
const btnUploadCsv = document.getElementById('btn-upload-csv');
const bankCsvInput = document.getElementById('bank-csv-input');

btnUploadCsv.addEventListener('click', () => {
  bankCsvInput.click();
});

bankCsvInput.addEventListener('change', () => {
  const file = bankCsvInput.files[0];
  if (!file) return;

  const formData = new FormData();
  formData.append('bankLog', file);

  btnUploadCsv.textContent = 'PARSING...';

  fetch('/api/upload-bank-log', {
    method: 'POST',
    body: formData
  })
  .then(res => res.json())
  .then(data => {
    if (data.error) {
      alert('Error: ' + data.error);
    } else {
      alert(`Success! Successfully loaded ${data.count} bank records from CSV.`);
    }
    btnUploadCsv.textContent = 'UPLOAD CSV';
    bankCsvInput.value = ''; // Reset input
  })
  .catch(err => {
    alert('Upload failed: ' + err.message);
    btnUploadCsv.textContent = 'UPLOAD CSV';
    bankCsvInput.value = '';
  });
});

