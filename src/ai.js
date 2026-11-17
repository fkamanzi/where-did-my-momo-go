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
import { CATEGORIES, reconcileNumbers } from './parser.js';

let ai = null;
// ?mode=cloud turns the on-device model off, to show the masked cloud path on any browser.
const FORCE_CLOUD = new URLSearchParams(self.location?.search || '').get('mode') === 'cloud';
export const state = { connected: false, onDevice: 'unknown', lastSource: null, onDeviceFails: 0, forceCloud: FORCE_CLOUD };

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

const CLOUD_MODEL = 'gemini-3.5-flash-lite';
// Text-only sessions. The SDK default also expects image input, which needs
// the multimodal model and makes every session slower to create.
const textOnly = () => ({
  expectedInputs: [{ type: 'text', languages: ['en'] }],
  expectedOutputs: [{ type: 'text', languages: ['en'] }],
});
// The first on-device call may load Gemini Nano into memory; later calls are quicker.
const FIRST_CALL_MS = 60000;
const NEXT_CALL_MS = 40000;
let onDeviceCalls = 0;

// Use the on-device model only when it is ready and has not just failed twice
// in a row; otherwise the masked cloud path answers so the app never waits.
async function onDeviceReady() {
  return !FORCE_CLOUD && state.onDeviceFails < 2 && (await checkOnDevice()) === 'available';
}
export function startRun() { state.onDeviceFails = 0; }

// Hold one session open so Chrome keeps the model in memory between messages.
let warmSession = null;
export async function warmOnDevice() {
  if (warmSession || !('LanguageModel' in self)) return;
  try { warmSession = await self.LanguageModel.create(textOnly()); } catch { /* stays cold */ }
}

// One-time download of Gemini Nano, started from a click (Chrome needs a user gesture).
export async function downloadOnDeviceModel(onProgress) {
  if (!('LanguageModel' in self)) return 'unavailable';
  const session = await self.LanguageModel.create({
    ...textOnly(),
    monitor(m) { m.addEventListener('downloadprogress', (e) => onProgress?.(e.loaded)); },
  });
  session.destroy?.();
  return checkOnDevice();
}

// Call Firebase AI Logic with a hard time limit on the on-device part. The abort
// signal stops Chrome's prompt itself, so a slow call never queues in front of
// the next message.
async function hybridCall(mode, prompt, { constraint = null, cloud }) {
  const ac = new AbortController();
  const promptOptions = { signal: ac.signal };
  if (constraint) promptOptions.responseConstraint = constraint;
  const m = getGenerativeModel(ai, {
    mode,
    onDeviceParams: { createOptions: { ...textOnly(), signal: ac.signal }, promptOptions },
    inCloudParams: cloud,
  });
  const timer = setTimeout(() => ac.abort(), onDeviceCalls++ === 0 ? FIRST_CALL_MS : NEXT_CALL_MS);
  try {
    const r = await m.generateContent(prompt);
    if (r.response.inferenceSource === 'on_device') state.onDeviceFails = 0;
    return r.response;
  } catch (e) {
    state.onDeviceFails++;
    throw e;
  } finally {
    clearTimeout(timer);
    m.chromeAdapter?.oldSession?.destroy?.(); // free the session now, not at garbage collection
  }
}

const CLOUD_LABEL = { model: CLOUD_MODEL, generationConfig: { temperature: 0 } };
const CLOUD_PROSE = { model: CLOUD_MODEL, generationConfig: { temperature: 0.4 } };
function cloudOnly(params) {
  return getGenerativeModel(ai, { mode: InferenceMode.ONLY_IN_CLOUD, inCloudParams: params });
}

export async function checkOnDevice() {
  try {
    if (!('LanguageModel' in self)) return (state.onDevice = 'unavailable');
    const a = await self.LanguageModel.availability(textOnly());
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

const CLOUD_JSON = { model: CLOUD_MODEL, generationConfig: { responseMimeType: 'application/json', responseSchema: TX_SCHEMA, temperature: 0 } };
const CATEGORY_JSON = { type: 'string', enum: CATEGORIES };

const READ_PROMPT = `You read one mobile-money SMS (English, French or Kinyarwanda) and return JSON only.
Fields: type, direction (in or out), amount (number, RWF), fee (number), balance (number), when (ISO date-time if present), party (the other side, as written), category (one of: ${CATEGORIES.join(', ')}).
A transfer to a person ("transferred", "sent", "envoyé", "Mwohereje") is type sent.
Copy numbers exactly as written; do not estimate. If a field is not in the message, leave it out.
SMS:
`;

function parseJson(text) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  const tx = JSON.parse(m[0]);
  // The party is the name; a phone number in brackets after it is not.
  if (tx.party) tx.party = String(tx.party).replace(/\s*\(\s*\+?\d[\d\s-]{5,}\)\s*$/, '').trim();
  return tx;
}

// Read one SMS. Returns a transaction with `source` saying where it ran.
export async function readSms(sms, redactor) {
  if (!ai) throw new Error('AI is not connected');
  if (await onDeviceReady()) {
    try {
      const r = await hybridCall(InferenceMode.ONLY_ON_DEVICE, READ_PROMPT + sms, { constraint: TX_JSON });
      const tx = reconcileNumbers(parseJson(r.text()), sms);
      if (tx) return { ...tx, source: 'on-device' };
    } catch (e) {
      // on-device failed or timed out: fall through to the masked cloud path
    }
  }
  const masked = redactor.redactText(sms);
  const r = await cloudOnly(CLOUD_JSON).generateContent(READ_PROMPT + masked);
  const tx = reconcileNumbers(parseJson(r.response.text()), sms);
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
  if (await onDeviceReady()) {
    try {
      const r = await hybridCall(InferenceMode.ONLY_ON_DEVICE, prompt(tx.party), { constraint: CATEGORY_JSON });
      return { category: pickCategory(r.text()), source: 'on-device' };
    } catch { /* fall through to the masked cloud path */ }
  }
  const r = await cloudOnly(CLOUD_LABEL).generateContent(prompt(partyForCloud));
  return { category: pickCategory(r.response.text()), source: 'cloud-masked', sentText: `${tx.type} of ${tx.amount} RWF to "${partyForCloud}"` };
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
  let r;
  if (await onDeviceReady()) {
    try { r = await hybridCall(InferenceMode.PREFER_ON_DEVICE, prompt, { cloud: CLOUD_PROSE }); } catch { /* cloud below */ }
  }
  if (!r) r = (await cloudOnly(CLOUD_PROSE).generateContent(prompt)).response;
  state.lastSource = r.inferenceSource || 'in_cloud';
  const text = redactor.restore(r.text()).trim().replace(/\n\s*\n+/g, '\n');
  return { text, source: state.lastSource };
}
