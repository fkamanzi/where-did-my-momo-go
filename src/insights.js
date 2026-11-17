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
