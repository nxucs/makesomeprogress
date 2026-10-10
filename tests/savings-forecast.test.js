const test = require('node:test');
const assert = require('node:assert/strict');
const SavingsForecast = require('../savings-forecast');

test('default House Fund schedule preserves actual, projected, and planned totals', () => {
  const forecast = SavingsForecast.calculateForecast(SavingsForecast.createExampleState(2026));

  assert.equal(forecast.actualTotal, 3200);
  assert.equal(forecast.projectedTotal, 42950);
  assert.equal(forecast.plannedTotal, 43750);
  assert.equal(forecast.pendingCount, 19);
  assert.deepEqual(forecast.goalStatuses[0].projectedHit, { month: 11, label: 'Bonus Check 3' });
});

test('new-account savings defaults have no imported goals or financial records', () => {
  const data = SavingsForecast.createDefaultState(2026);
  assert.deepEqual(data.contributions, []);
  assert.equal(data.goals[0].target, 0);
  assert.equal(SavingsForecast.calculateForecast(data).actualTotal, 0);
});

test('actual contributions replace rather than stack on planned amounts', () => {
  const data = SavingsForecast.createDefaultState(2026);
  data.contributions = [
    { id: 'one', month: 0, label: 'January', planned: 1000, actual: 800 },
    { id: 'two', month: 1, label: 'February', planned: 1000, actual: null }
  ];

  const forecast = SavingsForecast.calculateForecast(data);
  assert.equal(forecast.actualTotal, 800);
  assert.equal(forecast.projectedTotal, 1800);
  assert.equal(forecast.plannedTotal, 2000);
});

test('balance adjustments affect every forecast track deterministically', () => {
  const data = SavingsForecast.createDefaultState(2026);
  data.contributions = [{ id: 'one', month: 0, label: 'January', planned: 1000, actual: null }];
  data.startingBalance = 5000;
  data.additionalIn = 500;
  data.additionalOut = 250;

  const forecast = SavingsForecast.calculateForecast(data);
  assert.equal(forecast.openingNet, 5250);
  assert.equal(forecast.actualTotal, 5250);
  assert.equal(forecast.projectedTotal, 6250);
  assert.equal(forecast.plannedTotal, 6250);
});

test('multiple milestones share the forecast balance and report separate gaps', () => {
  const data = SavingsForecast.createDefaultState(2026);
  data.contributions = [
    { id: 'one', month: 0, label: 'January', planned: 5000, actual: 5000 },
    { id: 'two', month: 1, label: 'February', planned: 5000, actual: null }
  ];
  data.goals = [
    { id: 'first', name: 'Emergency fund', target: 5000, targetDate: '2026-06-30' },
    { id: 'second', name: 'House fund', target: 12000, targetDate: '2026-12-31' }
  ];
  data.activeGoalId = 'first';

  const forecast = SavingsForecast.calculateForecast(data);
  assert.equal(forecast.goalStatuses[0].actualGap, 0);
  assert.equal(forecast.goalStatuses[0].projectedHit.month, 0);
  assert.equal(forecast.goalStatuses[1].actualGap, 7000);
  assert.equal(forecast.goalStatuses[1].projectedGap, 2000);
  assert.equal(forecast.goalStatuses[1].projectedHit, null);
});

test('normalization repairs invalid data without losing valid entries', () => {
  const normalized = SavingsForecast.normalizeState({
    year: '2027',
    activeGoalId: 'missing',
    goals: [{ id: 'goal', name: 'Car', target: '12000', targetDate: 'invalid' }],
    contributions: [{ id: 'deposit', month: 99, label: 'Transfer', planned: '$1,250', actual: '' }]
  });

  assert.equal(normalized.year, 2027);
  assert.equal(normalized.activeGoalId, 'goal');
  assert.equal(normalized.goals[0].target, 12000);
  assert.equal(normalized.goals[0].targetDate, '2027-12-31');
  assert.equal(normalized.contributions[0].month, 11);
  assert.equal(normalized.contributions[0].planned, 1250);
  assert.equal(normalized.contributions[0].actual, null);
});

test('year progress clamps before and after the selected year', () => {
  assert.equal(SavingsForecast.calculateYearProgress(2026, new Date(2025, 11, 31)), 0);
  assert.equal(SavingsForecast.calculateYearProgress(2026, new Date(2027, 0, 1)), 100);
  assert.ok(SavingsForecast.calculateYearProgress(2026, new Date(2026, 6, 1)) > 49);
});
