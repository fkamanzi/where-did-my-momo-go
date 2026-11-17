import './styles.css';
import { parseSms, categoryFromType } from './parser.js';
import { createRedactor } from './redact.js';
import { summarise, rwf } from './insights.js';
import { SAMPLE_SMS } from './samples.js';
import { connect, checkOnDevice, downloadOnDeviceModel, warmOnDevice, startRun, readSms, categorise, writeInsights, state } from './ai.js';

const $ = s => document.querySelector(s);
const input = $('#sms');
const out = $('#results');

function badge(source) {
  const map = {
    'rules': ['Read by rules', 'b-rules'],
    'on-device': ['On this device', 'b-device'],
    'on_device': ['On this device', 'b-device'],
    'cloud-masked': ['Cloud, names masked', 'b-cloud'],
    'in_cloud': ['Cloud, totals only', 'b-cloud'],
  };
  const [label, cls] = map[source] || ['Unknown', 'b-rules'];
  return `<span class="badge ${cls}">${label}</span>`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// The money river: income on the left, flowing into where it went.
function river(sum) {
  const W = 640, H = 300, left = 130, right = 400, gap = 8, top = 16;
  const items = sum.byCategory.slice();
  const kept = sum.moneyIn - sum.moneyOut - sum.fees;
  if (kept > 0) items.push(['Still with you', kept]);
  const total = Math.max(sum.moneyIn, sum.moneyOut + sum.fees, 1);
  const scale = (H - gap * (items.length - 1)) / total;
  let yIn = top, yOut = top, lastLabel = -99;
  const flows = items.map(([cat, v], i) => {
    const h = Math.max(2, v * scale);
    const y0 = yIn, y1 = yOut, mid = (left + right) / 2;
    const path = `M${left},${y0} C${mid},${y0} ${mid},${y1} ${right},${y1} L${right},${y1 + h} C${mid},${y1 + h} ${mid},${y0 + h} ${left},${y0 + h} Z`;
    const ly = Math.max(y1 + h / 2 + 4, lastLabel + 15);
    lastLabel = ly;
    const cls = cat === 'Still with you' ? 'kept' : `f${i % 8}`;
    yIn += h; yOut += h + gap;
    return `<path d="${path}" class="flow ${cls}"><title>${esc(cat)}: ${rwf(v)}</title></path>
      <rect x="${right}" y="${y1}" width="6" height="${h}" class="end ${cls}"/>
      <text x="${right + 14}" y="${ly}" class="rl"><tspan class="rk">${esc(cat)}</tspan> ${rwf(v)}</text>`;
  }).join('');
  const inH = yIn - top;
  return `<svg viewBox="0 0 ${W} ${yOut + 10}" class="river" role="img" aria-label="Where the money went">
    <rect x="${left - 12}" y="${top}" width="12" height="${inH}" rx="3" class="src"/>
    <text x="${left - 20}" y="${top + inH / 2 - 6}" text-anchor="end" class="rl rk">Money in</text>
    <text x="${left - 20}" y="${top + inH / 2 + 12}" text-anchor="end" class="rl">${rwf(sum.moneyIn)}</text>
    ${flows}
  </svg>`;
}

function render(txs, sum, insight) {
  const rows = txs.map(t => `<tr>
      <td>${esc(t.when ? t.when.replace('T', ' ') : '')}</td>
      <td>${esc(t.type)}</td>
      <td>${esc(t.party || '')}</td>
      <td class="num ${t.direction === 'in' ? 'in' : 'out'}">${t.direction === 'in' ? '+' : '−'}${rwf(t.amount)}</td>
      <td class="num">${t.fee ? rwf(t.fee) : ''}</td>
      <td>${esc(t.category || '')}</td>
      <td>${badge(t.source)}</td></tr>`).join('');
  out.innerHTML = `
    <section class="headline">
      <p class="lead">You spent <b>${rwf(sum.moneyOut)}</b> and paid <b>${rwf(sum.fees)}</b> in fees
      (${(sum.feeShare * 100).toFixed(1)}% of what you sent).</p>
      ${sum.biggest ? `<p class="sub">Biggest outflow: ${rwf(sum.biggest.amount)} to ${esc(sum.biggest.party || sum.biggest.type)}.</p>` : ''}
    </section>
    <section class="card">${river(sum)}</section>
    <section class="card insight">
      <h2>What it means ${insight ? badge(insight.source) : ''}</h2>
      <div id="insight">${insight ? esc(insight.text).replace(/\n/g, '<br>') : 'Connect Firebase AI to get plain-language insights.'}</div>
    </section>
    <section class="card">
      <h2>Every message</h2>
      <table><thead><tr><th>When</th><th>Type</th><th>Who</th><th>Amount</th><th>Fee</th><th>Category</th><th>Read</th></tr></thead>
      <tbody>${rows}</tbody></table>
    </section>`;
}

const SOURCE_WORDS = { 'rules': 'by rules', 'on-device': 'on this device', 'cloud-masked': 'in the cloud, masked' };
function tally(txs) {
  const n = {};
  for (const t of txs) n[t.source] = (n[t.source] || 0) + 1;
  return Object.entries(SOURCE_WORDS).filter(([k]) => n[k]).map(([k, w]) => `${n[k]} ${w}`).join(' · ');
}

async function analyse() {
  const lines = input.value.split(/\n+/).map(s => s.trim()).filter(Boolean);
  const redactor = createRedactor();
  const txs = [];
  const go = $('#go');
  go.disabled = true;
  startRun();
  try {
    for (const [i, sms] of lines.entries()) {
      $('#status').textContent = `Reading message ${i + 1} of ${lines.length}…` + (txs.length ? ` (${tally(txs)})` : '');
      let tx = parseSms(sms);
      if (!tx && state.connected) {
        try { tx = await readSms(sms, redactor); } catch (e) { console.warn(e); }
      }
      if (!tx) continue;
      tx.category = tx.category || categoryFromType(tx);
      if (!tx.category && tx.direction === 'out' && state.connected) {
        try {
          const c = await categorise(tx, redactor);
          tx.category = c.category;
          if (tx.source === 'rules') tx.source = c.source;
        } catch (e) { console.warn(e); }
      }
      if (!tx.category) tx.category = tx.direction === 'in' ? 'Income' : 'Other';
      txs.push(tx);
    }
    const sum = summarise(txs);
    let insight = null;
    if (state.connected && txs.length) {
      $('#status').textContent = `Writing what it means… (${tally(txs)})`;
      try { insight = await writeInsights(sum, redactor); } catch (e) { console.warn(e); }
    }
    render(txs, sum, insight);
    $('#status').textContent = `${txs.length} of ${lines.length} messages read: ${tally(txs)} · ${redactor.size()} names and numbers masked before any cloud call`;
  } finally {
    go.disabled = false;
  }
}

async function boot() {
  $('#sample').onclick = () => { input.value = SAMPLE_SMS.join('\n'); };
  $('#go').onclick = analyse;
  const ok = await connect();
  const show = (dev) => {
    $('#ai-state').innerHTML = ok
      ? `Firebase AI connected · on-device model: <b>${esc(dev)}</b>` +
        (dev === 'downloadable' ? ' <button id="nano" class="ghost">Download Gemini Nano (one time)</button>' : '') +
        (dev === 'downloading' ? ' (until it finishes, messages use the masked cloud path)' : '')
      : 'Rules only: add firebase-config.json to turn on AI (see README).';
    const btn = $('#nano');
    if (btn) btn.onclick = async () => {
      btn.disabled = true;
      try {
        show(await downloadOnDeviceModel((p) => { btn.textContent = `Downloading… ${Math.round(p * 100)}%`; }));
        if (state.onDevice === 'available') warmOnDevice();
      } catch { show(await checkOnDevice()); }
    };
  };
  show(await checkOnDevice());
  if (ok && state.onDevice === 'available') warmOnDevice();
  if (ok) {
    const poll = setInterval(async () => {
      if (state.onDevice === 'available') return clearInterval(poll);
      show(await checkOnDevice());
      if (state.onDevice === 'available') warmOnDevice();
    }, 15000);
  }
}
boot();
