const API_BASE = '';

let allTransactions = [];

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function fetchJson(url, options = {}) {
  const res = await fetch(`${API_BASE}${url}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `Request failed: ${res.status}`);
  }
  return res.json();
}

function formatCurrency(amount, currency = 'KHR') {
  if (currency === 'KHR') return `៛${Math.round(amount).toLocaleString()}`;
  return `$${Number(amount).toFixed(2)}`;
}

function formatTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// KPI Cards
function renderKPIs(data) {
  const grid = document.getElementById('kpi-grid');
  const t = data.trends || {};
  const today = t.today || {};
  const thisWeek = t.this_week || {};
  const thisMonth = t.this_month || {};

  let dodHtml = '';
  if (t.dod_growth_pct !== null && t.dod_growth_pct !== undefined) {
    const isPositive = t.dod_growth_pct >= 0;
    const badgeClass = isPositive ? 'badge-growth-up' : 'badge-growth-down';
    const sign = isPositive ? '+' : '';
    dodHtml = `<span class="trend-badge ${badgeClass}">${sign}${t.dod_growth_pct}% vs yest</span>`;
  }

  const cards = [
    {
      label: "Today's Revenue",
      value: `~$${(today.total_usd_equiv || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      sub: `${formatCurrency(today.khr || 0, 'KHR')} • ${formatCurrency(today.usd || 0, 'USD')}`,
      badge: dodHtml,
    },
    {
      label: 'Today Volume',
      value: `${today.count || data.total_transactions || 0} txs`,
      sub: `Avg ticket: ~$${(data.average_payment_usd || 0).toFixed(2)}`,
      badge: '',
    },
    {
      label: 'This Week (7 Days)',
      value: `~$${(thisWeek.total_usd_equiv || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      sub: `${thisWeek.count || 0} transactions recorded`,
      badge: '',
    },
    {
      label: 'This Month (MTD)',
      value: `~$${(thisMonth.total_usd_equiv || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      sub: `${thisMonth.count || 0} transactions recorded`,
      badge: '',
    },
  ];

  grid.innerHTML = cards.map(c => `
    <div class="kpi-card">
      <div class="kpi-header">
        <span class="kpi-label">${escapeHtml(c.label)}</span>
        ${c.badge}
      </div>
      <span class="kpi-value">${escapeHtml(c.value)}</span>
      <span class="kpi-sub">${escapeHtml(c.sub)}</span>
    </div>
  `).join('');
}

// Operational Patterns
function renderPatterns(data) {
  const panel = document.getElementById('pattern-panel');
  if (!panel) return;
  const p = data.patterns || {};
  panel.innerHTML = `
    <div class="panel-header">
      <h2>Operational Pattern Intelligence</h2>
      <span class="badge-intel">AI Financial Insights</span>
    </div>
    <div class="pattern-grid">
      <div class="pattern-item">
        <span class="pattern-label">Peak Traffic Window</span>
        <span class="pattern-value highlight">⏰ ${escapeHtml(p.peak_hour_desc || 'N/A')}</span>
        <span class="pattern-sub">Busiest operational rush</span>
      </div>
      <div class="pattern-item">
        <span class="pattern-label">Dominant Payment Rail</span>
        <span class="pattern-value">💳 ${escapeHtml(p.dominant_payment_method || 'N/A')}</span>
        <span class="pattern-sub">Customer checkout preference</span>
      </div>
      <div class="pattern-item">
        <span class="pattern-label">Average Ticket Size</span>
        <span class="pattern-value">🎟️ $${Number(p.avg_ticket_usd || 0).toFixed(2)} / ${escapeHtml(formatCurrency(p.avg_ticket_khr || 0, 'KHR'))}</span>
        <span class="pattern-sub">Normalized spending baseline</span>
      </div>
      <div class="pattern-item">
        <span class="pattern-label">Integrity Status</span>
        <span class="pattern-value status-ok">🛡️ ${Number(data.duplicate_count || 0)} Flagged Duplicates</span>
        <span class="pattern-sub">${Number(data.pending_verification || 0)} awaiting manual review</span>
      </div>
    </div>
  `;
}

// Bank Revenue Cards
function renderBankGrid(data) {
  const grid = document.getElementById('bank-grid');
  const banks = data.revenue_by_bank || [];
  if (banks.length === 0) {
    grid.innerHTML = '<div class="bank-card empty">No bank data yet</div>';
    return;
  }
  grid.innerHTML = banks.map(b => {
    const parts = [];
    if (b.amount_usd > 0) parts.push(formatCurrency(b.amount_usd, 'USD'));
    if (b.amount_khr > 0) parts.push(formatCurrency(b.amount_khr, 'KHR'));
    const dualDisplay = parts.length > 0 ? parts.join(' • ') : '$0.00';
    return `
      <div class="bank-card">
        <div class="bank-card-header">
          <span class="bank-name">${escapeHtml(b.bank)}</span>
          <span class="badge-count">${Number(b.tx_count)} txs</span>
        </div>
        <span class="bank-amount">${escapeHtml(dualDisplay)}</span>
        <span class="bank-sub">Total ~${escapeHtml(formatCurrency(b.total_usd_equiv, 'USD'))}</span>
      </div>
    `;
  }).join('');
}

// Transactions Table
function renderTransactions(transactions) {
  allTransactions = transactions || [];
  const tbody = document.getElementById('transactions-body');
  if (allTransactions.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-row">No transactions found</td></tr>';
    return;
  }
  tbody.innerHTML = allTransactions.map(t => `
    <tr>
      <td>${escapeHtml(formatDateTime(t.transaction_time || t.created_at))}</td>
      <td>${escapeHtml(t.customer_name || '-')}</td>
      <td>${escapeHtml(t.merchant || '-')}</td>
      <td class="font-mono">${escapeHtml(t.transaction_id)}</td>
      <td class="font-mono">${escapeHtml(t.apv || '-')}</td>
      <td class="amount">${escapeHtml(formatCurrency(t.amount, t.currency))}</td>
      <td><span class="bank-badge">${escapeHtml(t.bank || '-')}</span></td>
    </tr>
  `).join('');
}

// Top Customers
function renderTopCustomers(data) {
  const list = document.getElementById('top-customers');
  const customers = data.top_customers || [];
  if (customers.length === 0) {
    list.innerHTML = '<li class="empty-row">No customer data</li>';
    return;
  }
  list.innerHTML = customers.map(c => {
    const parts = [];
    if (c.amount_usd > 0) parts.push(formatCurrency(c.amount_usd, 'USD'));
    if (c.amount_khr > 0) parts.push(formatCurrency(c.amount_khr, 'KHR'));
    const dualDisplay = parts.length > 0 ? parts.join(' • ') : '$0.00';
    return `
      <li>
        <div class="top-info">
          <span class="top-name">${escapeHtml(c.name)}</span>
          <span class="top-tx-count">${Number(c.tx_count)} orders</span>
        </div>
        <div class="top-totals">
          <span class="top-amount">${escapeHtml(dualDisplay)}</span>
          <span class="top-sub">~${escapeHtml(formatCurrency(c.total_usd_equiv, 'USD'))}</span>
        </div>
      </li>
    `;
  }).join('');
}

// Hourly Chart
function renderHourlyChart(data) {
  const chart = document.getElementById('hourly-chart');
  const hours = data.revenue_by_hour || [];
  if (hours.length === 0) {
    chart.innerHTML = '<div class="empty-row">No hourly data</div>';
    return;
  }
  const max = Math.max(...hours.map(h => h.total_usd_equiv || h.amount)) || 1;
  chart.innerHTML = hours.map(h => {
    const val = h.total_usd_equiv || h.amount;
    const pct = Math.max((val / max) * 100, 4);
    const tip = `${h.hour}:00 - ${h.tx_count} payments, ~$${val.toFixed(2)}`;
    return `
      <div class="chart-bar-wrap" title="${escapeHtml(tip)}">
        <div class="chart-bar" style="height: ${pct}%"></div>
        <span class="chart-hour">${h.hour}:00</span>
      </div>
    `;
  }).join('');
}

// Verification Result
function renderVerificationResult(result) {
  const el = document.getElementById('verification-result');
  el.style.display = 'block';
  const statusClass = {
    verified: 'success',
    payment_not_found: 'warning',
    duplicate_usage: 'danger',
  }[result.status] || 'warning';

  const statusText = escapeHtml((result.status || '').replace(/_/g, ' ').toUpperCase());
  const explanation = escapeHtml(result.explanation || '');
  const metaHtml = result.transaction
    ? `<div class="result-meta">${escapeHtml(formatCurrency(result.transaction.amount, result.transaction.currency))} via ${escapeHtml(result.transaction.bank || '-')}</div>`
    : '';

  el.innerHTML = `
    <div class="result-status ${statusClass}">${statusText}</div>
    <p>${explanation}</p>
    ${metaHtml}
  `;
}

// Search
async function handleSearch() {
  const q = document.getElementById('search-input').value.trim();
  try {
    const transactions = await fetchJson(`/transactions?q=${encodeURIComponent(q)}`);
    renderTransactions(transactions);
  } catch (err) {
    console.error('Search failed:', err);
  }
}

// Telegram Message
async function handleTelegram() {
  const text = document.getElementById('telegram-text').value.trim();
  if (!text) {
    alert('Please enter or paste a Telegram payment notification.');
    return;
  }
  const btn = document.getElementById('btn-send-telegram');
  btn.disabled = true;
  btn.textContent = 'Processing...';
  try {
    await fetchJson('/telegram/messages', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
    document.getElementById('telegram-text').value = '';
    await loadDashboard();
  } catch (err) {
    alert('Failed to parse notification: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Process Notification';
  }
}

// Verify Receipt
async function handleVerify() {
  const transactionId = document.getElementById('verify-tx-id').value.trim();
  const invoiceNumber = document.getElementById('verify-invoice').value.trim();
  if (!transactionId) {
    alert('Please enter a Transaction ID to verify.');
    return;
  }
  const btn = document.getElementById('btn-verify');
  btn.disabled = true;
  btn.textContent = 'Verifying...';
  try {
    const result = await fetchJson('/verification/check', {
      method: 'POST',
      body: JSON.stringify({ transaction_id: transactionId, invoice_number: invoiceNumber }),
    });
    renderVerificationResult(result);
    await loadDashboard();
  } catch (err) {
    alert('Verification failed: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Verify Receipt';
  }
}

// Reset Demo
async function handleReset() {
  if (!confirm('Reset all demo data?')) return;
  try {
    await fetchJson('/api/demo/reset', { method: 'POST' });
    await loadDashboard();
    document.getElementById('verification-result').style.display = 'none';
  } catch (err) {
    alert('Reset failed: ' + err.message);
  }
}

// Load Dashboard
async function loadDashboard() {
  try {
    const data = await fetchJson('/analytics/dashboard');
    renderKPIs(data);
    renderPatterns(data);
    renderBankGrid(data);
    renderTopCustomers(data);
    renderHourlyChart(data);
    renderTransactions(data.latest_transactions);
  } catch (err) {
    console.error('Failed to load dashboard:', err);
  }
}

// Init
document.addEventListener('DOMContentLoaded', () => {
  loadDashboard();

  document.getElementById('btn-reset').addEventListener('click', handleReset);
  document.getElementById('btn-send-telegram').addEventListener('click', handleTelegram);
  document.getElementById('btn-verify').addEventListener('click', handleVerify);
  document.getElementById('search-input').addEventListener('input', debounce(handleSearch, 300));

  // Enter to verify
  ['verify-tx-id', 'verify-invoice'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleVerify();
        }
      });
    }
  });

  // Ctrl+Enter or Cmd+Enter to send telegram message
  const tgInput = document.getElementById('telegram-text');
  if (tgInput) {
    tgInput.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handleTelegram();
      }
    });
  }
});

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
