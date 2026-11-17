# Where Did My MoMo Go?

See where your mobile money went, from the SMS your wallet already sends you. Built for #BuildHybridAI 2026 with **Firebase AI Logic hybrid inference**.

**Live demo:** https://where-did-my-momo-go.web.app (Firebase Hosting; mirror: https://fkamanzi.github.io/where-did-my-momo-go/). Best in desktop Chrome with the built-in Gemini Nano model; other browsers use the masked cloud path.

**Privacy by design:** raw SMS are read by Gemini Nano on your device. If your device has no on-device model, each message is masked first (names, phone numbers, meter and transaction IDs become pseudonyms such as `Person-A`, `#3`) and only then sent to Gemini in the cloud. The pseudonym map never leaves the browser, so answers are mapped back to real names locally.

## How it uses Firebase AI Logic

| Step | Data it sees | Inference mode | Why |
| --- | --- | --- | --- |
| Read an SMS the rules cannot parse (e.g. Kinyarwanda) | the full message | `ONLY_ON_DEVICE`, then `ONLY_IN_CLOUD` on the **masked** text | raw SMS never leave the phone |
| Categorise a counterparty | the name, or a pseudonym for individuals in the cloud | `ONLY_ON_DEVICE`, then `ONLY_IN_CLOUD` (masked) | businesses keep their names, people do not |
| Write insights | totals and pseudonyms only | `PREFER_ON_DEVICE` (the SDK's automatic cloud fallback) | nothing personal in the prompt |

Every figure on screen (totals, fees, fee share, biggest outflow) is computed by plain code in `src/insights.js`; the model words the insights but cannot invent numbers. When a model reads a message, each amount, fee and balance it returns is checked against the RWF figures actually written in that message (`reconcileNumbers` in `src/parser.js`), so a misread such as 10 for 10,000 is corrected before it reaches a total. Insight lines get the same treatment: a line quoting a figure that is not in the totals the model was given is left out (`guardInsight` in `src/insights.js`). Each row and the insight card show where they ran: **On this device**, **Cloud, names masked**, **Cloud, totals only** or **Read by rules**. Code: `src/ai.js` imports `firebase/ai` and calls `getGenerativeModel(ai, { mode: InferenceMode.… , onDeviceParams, inCloudParams })` at runtime. Each on-device task has its own `responseConstraint` (the transaction JSON schema for reading, the category enum for categorising, none for insights) and the cloud read uses a `responseSchema`. On-device sessions are text-only, a slow on-device prompt is aborted after a time limit so it never blocks the next message, and one warm session keeps Gemini Nano in memory.

**See both paths:** open the live demo as is to see Gemini Nano on your device, or add `?mode=cloud` (https://where-did-my-momo-go.web.app/?mode=cloud) to switch the on-device model off and watch the masked cloud path. After a run, open **What left this device** under the table: it lists the exact masked text each cloud call carried.

## Run it

```bash
npm install
npm test          # parser, masking, totals and figure checks (7 tests)
npm run dev       # http://localhost:5173
npm run build     # static site in dist/
```

Without Firebase it runs in rules-only mode (SMS in standard English formats).

## Connect your own Firebase project

The live demo already runs on the `where-did-my-momo-go` Firebase project (Spark plan, Gemini Developer API, App Check enforced with reCAPTCHA Enterprise). Its web config is committed in `public/firebase-config.json`: Firebase web configs are public identifiers by design, and App Check enforcement plus the reCAPTCHA domain list (fkamanzi.github.io only) are what protect the Gemini calls. To run a fork on your own project:

1. Firebase console → create a project → **AI Logic** → **Get started** → **Gemini Developer API** (App Check enforcement is switched on for AI Logic).
2. **Project settings → Your apps → Add app → Web**, and copy the `firebaseConfig` snippet.
3. In Google Cloud console → **Security → reCAPTCHA (Fraud Defense)**, create a Web key for your domain, then in Firebase **App Check → Apps** register the web app with that site key. Put the site key in `public/app-check.json`.
4. In your GitHub fork: **Settings → Secrets and variables → Actions → Variables → New repository variable** named `FIREBASE_CONFIG`, value = the snippet from step 2 (plain JSON or the `const firebaseConfig = {…}` text both work); it overrides the committed file at build time. **Settings → Pages → Source: GitHub Actions.** Every push to `main` runs the tests, writes `firebase-config.json` from that variable (`scripts/write-config.mjs`) and deploys to GitHub Pages. For Firebase Hosting: `npm run build && firebase deploy --only hosting` (config in `firebase.json`).
5. Local testing: put the same JSON plus `recaptchaEnterpriseSiteKey` in `public/firebase-config.json` (git-ignored), run `npm run dev`, and register the App Check debug token the browser console prints under **App Check → Apps → Manage debug tokens**.

## Demo video (under 3 minutes)

1. 0:00 The problem: money leaves through dozens of SMS; nobody adds them up.
2. 0:20 Paste a month of messages (sample set is invented) and press **Show me where it went**.
3. 0:40 The money river: income on the left, every category and what is still with you on the right.
4. 1:10 Point at the badges: rows read **On this device**; the Kinyarwanda message, unreadable by rules, is read by Gemini Nano.
5. 1:40 Switch to a browser without the on-device model: the same rows now read **Cloud, names masked**. Open DevTools → Network and show the request body: `Person-A`, `#3`, no real names or numbers.
6. 2:20 The insights card: fees cost 1.4% of what was sent, and one action to cut them.
7. 2:45 Close: your money explained, your messages kept.

## Licence

Apache 2.0. Sample messages are invented; any resemblance to real people is coincidental.
