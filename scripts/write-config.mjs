// Writes public/firebase-config.json at build time from the FIREBASE_CONFIG
// repository variable (the web config Firebase shows under Project settings).
// Accepts either plain JSON or the `const firebaseConfig = { ... };` snippet.
// The reCAPTCHA Enterprise site key (public by design) comes from public/app-check.json.
import { readFileSync, writeFileSync } from 'node:fs';

const raw = (process.env.FIREBASE_CONFIG || '').trim();
if (!raw) {
  console.warn('FIREBASE_CONFIG is empty: building in rules-only mode (no Firebase AI Logic).');
  process.exit(0);
}
const body = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
let config;
try {
  config = JSON.parse(body);
} catch {
  // JS object literal from the console snippet (unquoted keys, trailing commas)
  config = Function(`"use strict"; return (${body});`)();
}
for (const k of ['apiKey', 'projectId', 'appId']) {
  if (!config[k]) { console.error(`FIREBASE_CONFIG is missing "${k}"`); process.exit(1); }
}
const appCheck = JSON.parse(readFileSync(new URL('../public/app-check.json', import.meta.url)));
writeFileSync(new URL('../public/firebase-config.json', import.meta.url),
  JSON.stringify({ ...config, ...appCheck }, null, 2));
console.log(`Wrote public/firebase-config.json for project ${config.projectId}.`);
