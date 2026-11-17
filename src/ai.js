// Firebase AI Logic, hybrid inference.
//
// Two paths, both through the Firebase AI Logic SDK:
//  1. Reading a message (it holds names and numbers): ONLY_ON_DEVICE first,
//     with the full text. If no on-device model is available, the message is
//     masked (names and numbers become pseudonyms) and sent ONLY_IN_CLOUD.
//     Raw SMS never leaves the phone.
//  2. Writing insights (it sees only totals and pseudonyms): PREFER_ON_DEVICE,
//     the SDK's own automatic fallback to the cloud.

import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, Schema } from 'firebase/ai';
import { CATEGORIES } from './parser.js';

let ai = null;
export const state = { connected: false, onDevice: 'unknown', lastSource: null };

export async function connect() {
  let config;
  try {
    const res = await fetch('./firebase-config.json', { cache: 'no-store' });
    if (!res.ok) return false;
    config = await res.json();
  } catch { return false; }
  const app = initializeApp(config);
  if (location.hostname === 'localhost' || config.appCheckDebug) {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true; // registered in the console
  }
  if (config.recaptchaEnterpriseSiteKey) {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(config.recaptchaEnterpriseSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  }
  ai = getAI(app, { backend: new GoogleAIBackend() });
  state.connected = true;
  return true;
}

export async function checkOnDevice() {
  try {
    if (!('LanguageModel' in self)) return (state.onDevice = 'unavailable');
    const a = await self.LanguageModel.availability();
    return (state.onDevice = a); // 'available' | 'downloadable' | 'downloading' | 'unavailable'
  } catch { return (state.onDevice = 'unavailable'); }
}

const TX_JSON = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ['sent', 'received', 'payment', 'bill', 'airtime', 'withdrawal', 'deposit', 'other'] },
    direction: { type: 'string', enum: ['in', 'out'] },
    amount: { type: 'number' },
    fee: { type: 'number' },
    balance: { type: 'number' },
    when: { type: 'string' },
    party: { type: 'string' },
    category: { type: 'string', enum: CATEGORIES },
  },
  required: ['type', 'direction', 'amount', 'category'],
};

const TX_SCHEMA = Schema.object({
  properties: {
    type: Schema.enumString({ enum: ['sent', 'received', 'payment', 'bill', 'airtime', 'withdrawal', 'deposit', 'other'] }),
    direction: Schema.enumString({ enum: ['in', 'out'] }),
    amount: Schema.number(),
    fee: Schema.number(),
    balance: Schema.number(),
    when: Schema.string(),
    party: Schema.string(),
    category: Schema.enumString({ enum: CATEGORIES }),
  },
  optionalProperties: ['fee', 'balance', 'when', 'party'],
});

const READ_PROMPT = `You read one mobile-money SMS (English, French or Kinyarwanda) and return JSON only.
Fields: type, direction (in or out), amount (number, RWF), fee (number), balance (number), when (ISO date-time if present), party (the other side, as written), category (one of: ${CATEGORIES.join(', ')}).
Copy numbers exactly as written; do not estimate. If a field is not in the message, leave it out.
SMS:
`;

function model(mode, cloudJson) {
  return getGenerativeModel(ai, {
    mode,
    onDeviceParams: { promptOptions: { responseConstraint: TX_JSON } },
    inCloudParams: cloudJson ? {
      model: 'gemini-3.5-flash-lite',
      generationConfig: { responseMimeType: 'application/json', responseSchema: TX_SCHEMA, temperature: 0 },
    } : { model: 'gemini-3.5-flash-lite', generationConfig: { temperature: 0.4 } },
  });
}

function parseJson(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : null;
}

// Read one SMS. Returns a transaction with `source` saying where it ran.
export async function readSms(sms, redactor) {
  if (!ai) throw new Error('AI is not connected');
  try {
    const r = await model(InferenceMode.ONLY_ON_DEVICE, true).generateContent(READ_PROMPT + sms);
    const tx = parseJson(r.response.text());
    if (tx) return { ...tx, source: 'on-device' };
  } catch (e) {
    // no on-device model: fall through to the masked cloud path
  }
  const masked = redactor.redactText(sms);
  const r = await model(InferenceMode.ONLY_IN_CLOUD, true).generateContent(READ_PROMPT + masked);
  const tx = parseJson(r.response.text());
  if (!tx) throw new Error('No JSON in model answer');
  if (tx.party) tx.party = redactor.restore(tx.party);
  return { ...tx, source: 'cloud-masked', sentText: masked };
}

// Categorise a counterparty the rules could not place.
export async function categorise(tx, redactor) {
  const isBusiness = /^[A-Z0-9 &'.-]+$/.test(tx.party || '') ||
    /(shop|supermarket|market|pharmacy|ltd|school|ecole|hospital|clinic|electricity|water|restaurant|hotel|bus|telecom|bank)/i.test(tx.party || '');
  const partyForCloud = isBusiness ? tx.party : `${redactor.redactParty(tx.party)} (an individual)`;
  const prompt = (party) => `Pick one category for a mobile-money ${tx.type} of ${tx.amount} RWF to "${party}".
Categories: ${CATEGORIES.join(', ')}. Answer with the category name only.`;
  try {
    const r = await model(InferenceMode.ONLY_ON_DEVICE, false).generateContent(prompt(tx.party));
    return { category: pickCategory(r.response.text()), source: 'on-device' };
  } catch {
    const r = await model(InferenceMode.ONLY_IN_CLOUD, false).generateContent(prompt(partyForCloud));
    return { category: pickCategory(r.response.text()), source: 'cloud-masked' };
  }
}

function pickCategory(text) {
  const t = String(text).toLowerCase();
  return CATEGORIES.find(c => t.includes(c.toLowerCase())) || 'Other';
}

// Insights: totals and pseudonyms only, so the SDK's PREFER_ON_DEVICE
// fallback to the cloud is safe here.
export async function writeInsights(summary, redactor) {
  const safe = {
    moneyIn: summary.moneyIn, moneyOut: summary.moneyOut, fees: summary.fees,
    feeSharePercent: Math.round(summary.feeShare * 1000) / 10,
    byCategory: summary.byCategory,
    topParties: summary.topParties.map(([p, v]) => [redactor.redactParty(p), v]),
  };
  const prompt = `You are a friendly money coach in Rwanda. From these mobile-money totals for one month (RWF), write exactly 3 short insights and 1 practical action.
Use only the numbers given; do not invent figures. Plain words, one line each, start each line with "- ".
${JSON.stringify(safe)}`;
  const r = await model(InferenceMode.PREFER_ON_DEVICE, false).generateContent(prompt);
  state.lastSource = r.response.inferenceSource || null;
  return { text: redactor.restore(r.response.text()), source: r.response.inferenceSource || 'unknown' };
}
