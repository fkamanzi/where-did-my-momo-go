import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSms, categoryFromType, moneyFigures, reconcileNumbers } from '../src/parser.js';
import { createRedactor } from '../src/redact.js';
import { summarise, guardInsight } from '../src/insights.js';
import { SAMPLE_SMS } from '../src/samples.js';

test('sent message: amount, fee, balance, party, date', () => {
  const t = parseSms(SAMPLE_SMS[1]);
  assert.equal(t.type, 'sent'); assert.equal(t.direction, 'out');
  assert.equal(t.amount, 15000); assert.equal(t.fee, 250); assert.equal(t.balance, 116250);
  assert.equal(t.party, 'Jean Bosco Habimana'); assert.equal(t.when, '2026-11-02T09:14');
});
test('received, payment, airtime, bill, withdrawal types', () => {
  assert.equal(parseSms(SAMPLE_SMS[0]).type, 'received');
  assert.equal(parseSms(SAMPLE_SMS[0]).direction, 'in');
  assert.equal(parseSms(SAMPLE_SMS[2]).type, 'payment');
  assert.equal(parseSms(SAMPLE_SMS[2]).party, 'SIMBA SUPERMARKET');
  assert.equal(parseSms(SAMPLE_SMS[3]).type, 'airtime');
  assert.equal(parseSms(SAMPLE_SMS[4]).type, 'bill');
  assert.equal(parseSms(SAMPLE_SMS[5]).type, 'withdrawal');
  assert.equal(parseSms(SAMPLE_SMS[5]).fee, 700);
  assert.equal(categoryFromType(parseSms(SAMPLE_SMS[5])), 'Cash withdrawal');
});
test('Kinyarwanda message is left to the AI step', () => {
  assert.equal(parseSms(SAMPLE_SMS[8]), null);
});
test('redaction masks names and long numbers, keeps amounts, restores locally', () => {
  const r = createRedactor();
  const masked = r.redactText(SAMPLE_SMS[1]);
  assert.ok(!masked.includes('Jean Bosco'));
  assert.ok(!masked.includes('250788100002'));
  assert.ok(masked.includes('15,000 RWF'));
  assert.equal(r.restore('Person-A got money'), 'Jean Bosco Habimana got money');
});
test('summary totals and fee share', () => {
  const txs = SAMPLE_SMS.map(parseSms).filter(Boolean).map(t => ({ ...t, category: categoryFromType(t) || 'Other' }));
  const s = summarise(txs);
  assert.equal(s.moneyIn, 120000);
  assert.equal(s.moneyOut, 15000 + 8700 + 2000 + 12000 + 30000 + 5000 + 4500 + 20000);
  assert.equal(s.fees, 250 + 100 + 700 + 100 + 250);
  assert.ok(s.feeShare > 0.01 && s.feeShare < 0.02);
});

test('model figures are checked against the figures written in the message', () => {
  const sms = SAMPLE_SMS[8];
  assert.deepEqual(moneyFigures(sms), [10000, 200, 42950]);
  const fixed = reconcileNumbers({ type: 'sent', direction: 'out', amount: 10, fee: 200, balance: 42950, category: 'Family & friends' }, sms);
  assert.equal(fixed.amount, 10000); assert.equal(fixed.fee, 200); assert.equal(fixed.balance, 42950);
  const dropped = reconcileNumbers({ type: 'sent', direction: 'out', amount: 777, fee: 999, balance: 5, category: 'Other' }, sms);
  assert.equal(dropped.amount, 10000); assert.equal(dropped.fee, 0); assert.equal(dropped.balance, undefined);
});

test('insight lines that quote a figure not in the totals are left out', () => {
  const txs = SAMPLE_SMS.map(parseSms).filter(Boolean).map(t => ({ ...t, category: categoryFromType(t) || 'Other' }));
  const s = summarise(txs);
  const model = [
    "Here's a breakdown:",
    `- You received RWF ${s.moneyIn.toLocaleString('en-US')} this month.`,
    '- You have RWF 12,800 left.',
    `- Fees were ${(s.feeShare * 100).toFixed(1)}% of what you sent.`,
    '- Try moving a little to savings each week.',
  ].join('\n');
  const g = guardInsight(model, s);
  assert.equal(g.dropped, 1);
  assert.ok(!g.text.includes('12,800'));
  assert.ok(!g.text.includes('breakdown'));
  assert.equal(g.text.split('\n').length, 3);
});
