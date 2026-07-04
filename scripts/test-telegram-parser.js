const assert = require('assert');
const { extractTransactionId, parseBankNotification, parseReceiptOcrText } = require('../telegram-parser');

const samples = [
  {
    name: 'ABA PAY KHR',
    text: '៛100 paid by LY LAISRUN (*964) on Jul 04, 02:14 PM via ABA PAY at KIM PUTDARARITH. Trx. ID: 178314927151090, APV: 444368.',
    expected: {
      trxId: '178314927151090',
      amount: 100,
      currency: 'KHR',
      sender: 'LY LAISRUN (*964)',
      merchant: 'KIM PUTDARARITH'
    }
  },
  {
    name: 'ABA PAY KHR second sample',
    text: '៛200 paid by ROEURN PHANNET (*943) on Jul 04, 02:14 PM via ABA PAY at KIM PUTDARARITH. Trx. ID: 178314929484377, APV: 275770.',
    expected: {
      trxId: '178314929484377',
      amount: 200,
      currency: 'KHR',
      sender: 'ROEURN PHANNET (*943)',
      merchant: 'KIM PUTDARARITH'
    }
  },
  {
    name: 'ABA KHQR with bank name',
    text: '៛100 paid by Hoa Ratha (*221) on Jul 04, 02:18 PM via ABA KHQR (ACLEDA Bank Plc.) at KIM PUTDARARITH. Trx. ID: 178314949354277, APV: 380602.',
    expected: {
      trxId: '178314949354277',
      amount: 100,
      currency: 'KHR',
      sender: 'Hoa Ratha (*221)',
      merchant: 'KIM PUTDARARITH'
    }
  }
];

for (const sample of samples) {
  const parsed = parseBankNotification(sample.text);
  assert(parsed, `${sample.name} should parse`);
  assert.strictEqual(parsed.trxId, sample.expected.trxId, `${sample.name} trxId`);
  assert.strictEqual(parsed.id, sample.expected.trxId, `${sample.name} id`);
  assert.strictEqual(parsed.amount, sample.expected.amount, `${sample.name} amount`);
  assert.strictEqual(parsed.currency, sample.expected.currency, `${sample.name} currency`);
  assert.strictEqual(parsed.sender, sample.expected.sender, `${sample.name} sender`);
  assert.strictEqual(parsed.merchant, sample.expected.merchant, `${sample.name} merchant`);
}

assert.strictEqual(extractTransactionId(samples[0].text), '178314927151090');
assert.strictEqual(extractTransactionId(samples[2].text), '178314949354277');

const receiptOcr = `
-100.00 KHR
KIM PUTDARARITH
Trx. ID: 56890713679
APV: 565799
From account: LY LAISRUN (011 624 964)
Original amount: 100.00 KHR
Purchase #: 178315165046595
Reference #: 100FT38202626009
Seller: KIM PUTDARARITH
Transaction date: Jul 04, 2026 02:54 PM
`;

const parsedReceipt = parseReceiptOcrText(receiptOcr);
assert(parsedReceipt, 'receipt OCR should parse');
assert.strictEqual(parsedReceipt.id, '100FT38202626009');
assert.strictEqual(parsedReceipt.trxId, '56890713679');
assert.strictEqual(parsedReceipt.amount, 100);
assert.strictEqual(parsedReceipt.currency, 'KHR');
assert.strictEqual(parsedReceipt.sender, 'LY LAISRUN (011 624 964)');
assert.strictEqual(parsedReceipt.merchant, 'KIM PUTDARARITH');

// Test verifyAuditBotSender
const { verifyAuditBotSender } = require('../telegram-parser');

// 1. Matches expected exact username
assert.strictEqual(verifyAuditBotSender({ is_bot: true, username: 'auditbot' }, 'auditbot'), true);
assert.strictEqual(verifyAuditBotSender({ is_bot: true, username: 'AuditBot' }, 'auditbot'), true);

// 2. Matches audit in username or first name
assert.strictEqual(verifyAuditBotSender({ is_bot: true, username: 'my_audit_bot' }), true);
assert.strictEqual(verifyAuditBotSender({ is_bot: true, first_name: 'ABA Audit Bot' }), true);

// 3. Matches aba in username
assert.strictEqual(verifyAuditBotSender({ is_bot: true, username: 'aba_recon_bot' }), true);

// 4. Returns false if not a bot (spoof attempt by real user)
assert.strictEqual(verifyAuditBotSender({ is_bot: false, username: 'auditbot' }), false);
assert.strictEqual(verifyAuditBotSender({ is_bot: undefined, username: 'auditbot' }), false);

// 5. Returns false if bot but unrelated
assert.strictEqual(verifyAuditBotSender({ is_bot: true, username: 'some_other_bot' }), false);

console.log('All parser samples passed.');
