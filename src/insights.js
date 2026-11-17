// Pure aggregation: no AI, no network. Numbers shown to the user come from
// here, so a model can phrase insights but never invent the figures.

export function summarise(txs) {
  const out = txs.filter(t => t.direction === 'out');
  const inn = txs.filter(t => t.direction === 'in');
  const sum = a => a.reduce((s, t) => s + (t.amount || 0), 0);
  const fees = txs.reduce((s, t) => s + (t.fee || 0), 0);
  const byCategory = {};
  for (const t of out) {
    const c = t.category || 'Other';
    byCategory[c] = (byCategory[c] || 0) + t.amount + (t.fee || 0);
  }
  const byParty = {};
  for (const t of out) {
    if (!t.party) continue;
    byParty[t.party] = (byParty[t.party] || 0) + t.amount;
  }
  const topParties = Object.entries(byParty).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const spent = sum(out);
  return {
    count: txs.length,
    moneyIn: sum(inn),
    moneyOut: spent,
    fees,
    feeShare: spent ? fees / spent : 0,
    byCategory: Object.entries(byCategory).sort((a, b) => b[1] - a[1]),
    topParties,
    biggest: out.slice().sort((a, b) => b.amount - a.amount)[0] || null,
  };
}

export function rwf(n) {
  return `${Math.round(n).toLocaleString('en-US')} RWF`;
}

const NUM_IN_TEXT = /\d{1,3}(?:[ ,]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
function numbersIn(line) {
  return (String(line).match(NUM_IN_TEXT) || []).map(s => Number(s.replace(/[ ,]/g, '')));
}

// The figures a model may quote: exactly the totals it was given.
export function allowedFigures(sum) {
  return [sum.moneyIn, sum.moneyOut, sum.fees, Math.round(sum.feeShare * 1000) / 10,
    sum.moneyIn - sum.moneyOut - sum.fees,
    ...sum.byCategory.map(([, v]) => v), ...sum.topParties.map(([, v]) => v)];
}

// Plain-code insights, used when too few model lines pass the figure check.
export function codeInsight(sum) {
  const top = sum.byCategory[0];
  const kept = sum.moneyIn - sum.moneyOut - sum.fees;
  return [
    top ? `- Your biggest category was ${top[0]} at ${rwf(top[1])}.` : null,
    `- Fees took ${rwf(sum.fees)}, ${(sum.feeShare * 100).toFixed(1)}% of what you sent.`,
    kept > 0 ? `- ${rwf(kept)} is still with you.` : '- You sent more than you received this month.',
  ].filter(Boolean).join('\n');
}

// Keep the model's words, not its arithmetic: a line that quotes a figure not in
// the totals is dropped, and any preamble before the "- " lines is left out.
export function guardInsight(text, sum) {
  const allowed = allowedFigures(sum);
  const ok = n => n <= 10 || allowed.some(a => Math.abs(a - n) <= Math.max(0.05, Math.abs(a) * 0.0005));
  const lines = String(text).split('\n').map(s => s.trim()).filter(Boolean);
  const bullets = lines.filter(l => /^[-•*]\s/.test(l));
  const use = bullets.length >= 3 ? bullets : lines;
  const kept = use.filter(l => numbersIn(l).every(ok));
  if (kept.length >= 2) return { text: kept.join('\n'), dropped: use.length - kept.length };
  return { text: codeInsight(sum), dropped: use.length };
}
