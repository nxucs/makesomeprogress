const test = require('node:test');
const assert = require('node:assert/strict');
const scheduler = require('../bill-scheduler.js');

const ymd = dates => dates.map(scheduler.formatDateYMD);

test('includes every bill occurrence on inclusive check boundaries', () => {
  assert.deepEqual(
    ymd(scheduler.getOccurrencesInRange('2026-08-02', 'monthly', '2026-07-29', '2026-08-11')),
    ['2026-08-02']
  );
  assert.deepEqual(
    ymd(scheduler.getOccurrencesInRange('2026-08-11', 'monthly', '2026-07-29', '2026-08-11')),
    ['2026-08-11']
  );
});

test('returns all weekly occurrences in a two-week check period', () => {
  assert.deepEqual(
    ymd(scheduler.getOccurrencesInRange('2026-08-01', 'weekly', '2026-08-01', '2026-08-14')),
    ['2026-08-01', '2026-08-08']
  );
});

test('preserves the anchor day through short months', () => {
  assert.deepEqual(
    ymd(scheduler.getOccurrencesInRange('2024-01-31', 'monthly', '2024-02-01', '2024-03-31')),
    ['2024-02-29', '2024-03-31']
  );
});

test('supports every configured long recurrence interval', () => {
  const expected = {
    bimonthly: ['2026-01-15', '2026-03-15', '2026-05-15'],
    quarterly: ['2026-01-15', '2026-04-15'],
    semiannual: ['2026-01-15'],
    annual: ['2026-01-15']
  };
  for (const [interval, dates] of Object.entries(expected)) {
    assert.deepEqual(ymd(scheduler.getOccurrencesInRange('2026-01-15', interval, '2026-01-01', '2026-06-30')), dates);
  }
});

test('biweekly recurrences remain exactly fourteen days apart across a month boundary', () => {
  assert.deepEqual(
    ymd(scheduler.getOccurrencesInRange('2026-01-23', 'biweekly', '2026-01-20', '2026-02-28')),
    ['2026-01-23', '2026-02-06', '2026-02-20']
  );
});

test('the same due date is scheduled into each overlapping test period', () => {
  const bill = { sourceType: 'recurring', sourceId: 7, name: 'ATT Phone Bill', amount: 200, category: 'Utilities', dates: ['2026-08-02'] };
  const check20 = { items: [] };
  const check21 = { items: [] };
  scheduler.reconcileScheduledItems(check20, bill);
  scheduler.reconcileScheduledItems(check21, bill);
  assert.equal(check20.items[0].dueDate, '2026-08-02');
  assert.equal(check21.items[0].dueDate, '2026-08-02');
});

test('editing a due date moves an unpaid scheduled item without duplicating it', () => {
  const log = { items: [{ id: 1, bill: 'Car Payment', cost: 500, dueDate: '2026-08-01', paid: false }] };
  scheduler.reconcileScheduledItems(log, {
    sourceType: 'recurring', sourceId: 9, name: 'Car Payment', previousNames: ['Car Payment'], amount: 500, category: 'Transportation', dates: ['2026-08-05']
  });
  assert.equal(log.items.length, 1);
  assert.equal(log.items[0].dueDate, '2026-08-05');
  assert.equal(log.items[0].scheduleSourceId, 9);
});

test('expense amount and category edits propagate to an unpaid scheduled row', () => {
  const log = { items: [{ id: 1, bill: 'Car Payment', cost: 500, category: 'Debt', dueDate: '2026-08-05', paid: false }] };
  scheduler.reconcileScheduledItems(log, {
    sourceType: 'recurring', sourceId: 9, name: 'Car Payment', amount: 540, category: 'Transportation', dates: ['2026-08-05']
  });
  assert.equal(log.items[0].cost, 540);
  assert.equal(log.items[0].category, 'Transportation');
});

test('an already-paid matching occurrence is not duplicated', () => {
  const log = { items: [{ id: 1, bill: 'Car Payment', cost: 500, dueDate: '2026-08-05', paid: true }] };
  scheduler.reconcileScheduledItems(log, {
    sourceType: 'recurring', sourceId: 9, name: 'Car Payment', amount: 500, category: 'Transportation', dates: ['2026-08-05']
  });
  assert.equal(log.items.length, 1);
  assert.equal(log.items[0].paid, true);
});

test('paid history is preserved while a newly required occurrence is never omitted', () => {
  const log = { items: [{ id: 1, bill: 'Car Payment', cost: 500, dueDate: '2026-08-01', paid: true, scheduleSourceType: 'recurring', scheduleSourceId: 9 }] };
  scheduler.reconcileScheduledItems(log, {
    sourceType: 'recurring', sourceId: 9, name: 'Car Payment', amount: 500, category: 'Transportation', dates: ['2026-08-05']
  });
  assert.deepEqual(log.items.map(item => [item.dueDate, item.paid]), [['2026-08-01', true], ['2026-08-05', false]]);
});

test('a one-time expense moves between periods when its date changes', () => {
  const firstLog = { items: [] };
  const secondLog = { items: [] };
  const initial = { sourceType: 'one-time', sourceId: 22, name: 'Registration', amount: 75, category: 'Transportation', dates: ['2026-08-02'] };
  scheduler.reconcileScheduledItems(firstLog, initial);
  scheduler.reconcileScheduledItems(secondLog, { ...initial, dates: [] });
  scheduler.reconcileScheduledItems(firstLog, { ...initial, dates: [] });
  scheduler.reconcileScheduledItems(secondLog, { ...initial, dates: ['2026-08-16'] });
  assert.equal(firstLog.items.length, 0);
  assert.equal(secondLog.items[0].dueDate, '2026-08-16');
});

test('changing a repeated weekly bill to monthly clears unpaid repeats in the check', () => {
  const log = { items: [] };
  const schedule = { sourceType: 'recurring', sourceId: 12, name: 'Payment', amount: 100, category: 'Housing' };
  scheduler.reconcileScheduledItems(log, { ...schedule, dates: ['2026-10-16', '2026-10-23'] });
  scheduler.reconcileScheduledItems(log, {
    ...schedule, dates: ymd(scheduler.getOccurrencesInRange('2026-10-16', 'monthly', '2026-10-13', '2026-10-26'))
  });
  assert.deepEqual(log.items.map(item => item.dueDate), ['2026-10-16']);
});
