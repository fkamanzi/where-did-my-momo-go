// Deterministic parser for mobile-money SMS. Handles the common shapes
// (sent, received, payment, bill, airtime, withdrawal, deposit) and returns
// null when a message does not match, so the AI step can take it.

const NUM = String.raw`(\d{1,3}(?:[ ,.]\d{3})+|\d+)(?:\.\d+)?`;

function toNumber(s) {
  if (s == null) return null;
  return Number(String(s).replace(/[ ,]/g, '').replace(/\.(?=\d{3}\b)/g, ''));
}

function findAmount(text) {
  const m = text.match(new RegExp(`${NUM}\\s*(?:RWF|FRW|Frw)`, 'i')) ||
            text.match(new RegExp(`(?:RWF|FRW|Frw)\\s*${NUM}`, 'i'));
  return m ? toNumber(m[1]) : null;
}

function findAfter(label, text) {
  const m = text.match(new RegExp(`${label}[^0-9]{0,20}${NUM}`, 'i'));
  return m ? toNumber(m[1]) : null;
}

function findDate(text) {
  let m = text.match(/(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::\d{2})?/);
  if (m) return `${m[1]}T${m[2]}`;
  m = text.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4]}`;
  return null;
}

function findParty(text, words) {
  for (const w of words) {
    const m = text.match(new RegExp(`\\b${w}\\s+(.+?)(?=\\s*\\(|\\s+on\\s+\\d|\\s+at\\s+\\d|\\s+for\\s|\\.\\s|,|$)`, 'i'));
    if (m) return m[1].trim();
  }
  return null;
}

const RULES = [
  { type: 'airtime', test: /airtime|bundle/i, party: ['for'] },
  { type: 'withdrawal', test: /withdr[ae]wn|withdrawal|cash out/i, party: ['from agent', 'from'] },
  { type: 'deposit', test: /deposit(ed)?|cash in/i, party: ['by agent', 'from agent', 'from'] },
  { type: 'bill', test: /\b(bill|electricity|water|meter|token|tv subscription)\b/i, party: ['to'] },
  { type: 'payment', test: /\bpayment\b|\bpaid\b|\bmerchant\b/i, party: ['to'] },
  { type: 'received', test: /\breceived\b/i, party: ['from'] },
  { type: 'sent', test: /\btransferred\b|\bsent\b/i, party: ['to'] },
];

export function parseSms(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const amount = findAmount(raw);
  if (amount == null) return null;
  const rule = RULES.find(r => r.test.test(raw));
  if (!rule) return null;
  const fee = findAfter('fee', raw) ?? 0;
  const balance = findAfter('balance', raw);
  const when = findDate(raw);
  let party = findParty(raw, rule.party);
  if (party) party = party.replace(/\s+/g, ' ').replace(/^(the\s+)/i, '');
  const direction = ['received', 'deposit'].includes(rule.type) ? 'in' : 'out';
  return { type: rule.type, direction, amount, fee, balance, when, party, source: 'rules' };
}

export const CATEGORIES = [
  'Family & friends', 'Food & groceries', 'Transport', 'Bills & utilities',
  'Airtime & data', 'Cash withdrawal', 'Business', 'Health', 'Education', 'Other',
];

// Categories that follow from the transaction type alone, with no guess.
export function categoryFromType(tx) {
  if (tx.type === 'airtime') return 'Airtime & data';
  if (tx.type === 'withdrawal') return 'Cash withdrawal';
  if (tx.type === 'bill') return 'Bills & utilities';
  return null;
}
