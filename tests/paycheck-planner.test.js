const test = require('node:test');
const assert = require('node:assert/strict');
const planner = require('../paycheck-planner');
const scheduler = require('../bill-scheduler');

test('15th/30th scheduled paydays remain distinct from two-day early access', () => {
  assert.deepEqual(planner.nextPayInfo('2026-10-13',2,true), {scheduledDate:'2026-10-15',expectedDate:'2026-10-13',earlyAccessDays:2});
  assert.equal(planner.nextPayday('2026-10-13','semimonthly',2),'2026-10-28');
  assert.deepEqual(planner.period('2026-10-13','semimonthly',undefined,2),{startDate:'2026-10-13',endDate:'2026-10-27'});
  assert.equal(planner.nextPayday('2026-10-28','semimonthly',2),'2026-11-13');
  assert.equal(planner.nextPayday('2026-12-28','semimonthly',2),'2027-01-13');
});
test('February and actual deposit overrides use calendar days without invented bank rules', () => {
  assert.deepEqual(planner.nextPayInfo('2026-02-13',2), {scheduledDate:'2026-02-28',expectedDate:'2026-02-26',earlyAccessDays:2});
  assert.equal(planner.nextPayday('2024-02-13','semimonthly',2),'2024-02-27');
  assert.deepEqual(planner.period('2026-10-14','semimonthly','2026-10-29',2),{startDate:'2026-10-14',endDate:'2026-10-28'});
  assert.equal(planner.nextPayday('2026-10-13','biweekly',2),'2026-10-27');
});

test('paycheck suggestion is dynamic, uses valid period ends, and preserves histories', () => {
  const logs=[{startDate:'2026-09-29',endDate:'2026-10-12'},{startDate:'2026-10-13',endDate:'2026-10-26'}];
  const before=JSON.stringify(logs);
  assert.equal(planner.suggestNextStart(logs),'2026-10-27');
  assert.equal(planner.suggestNextStart([{startDate:'2026-02-15'}],'semimonthly'),'2026-02-28');
  assert.equal(planner.suggestNextStart([{startDate:'bad',endDate:'bad'}],undefined,new Date(2027,0,2)),'2027-01-02');
  assert.equal(planner.suggestNextStart([{startDate:'2026-09-01',endDate:'2026-10-30'},...logs]),'2026-10-31');
  assert.equal(JSON.stringify(logs),before);
});

test('September 29 check excludes October 13 payday and suggests October 13', () => {
  assert.deepEqual(planner.period('2026-09-29'), {startDate: '2026-09-29', endDate: '2026-10-12'});
  assert.equal(planner.nextPayday('2026-09-29'), '2026-10-13');
  assert.deepEqual(scheduler.getOccurrencesInRange('2026-10-13', 'monthly', '2026-09-29', '2026-10-12'), []);
});
test('explicit early deposits control only the newly created period', () => {
  assert.deepEqual(planner.period('2026-09-29', 'semimonthly', '2026-10-13'), {startDate:'2026-09-29',endDate:'2026-10-12'});
  assert.throws(() => planner.period('2026-10-13', 'biweekly', '2026-10-13'));
});
test('semimonthly payday clamps February and crosses December correctly', () => {
  assert.equal(planner.nextPayday('2024-02-15','semimonthly'),'2024-02-29');
  assert.equal(planner.nextPayday('2026-02-15','semimonthly'),'2026-02-28');
  assert.equal(planner.nextPayday('2026-12-30','semimonthly'),'2027-01-15');
  assert.equal(planner.nextPayday('2026-10-13','semimonthly'),'2026-10-15');
});
test('repeat and intersecting check periods are rejected without changing logs', () => {
  const logs=[{name:'Check 23',startDate:'2026-09-29',endDate:'2026-10-12',items:[]}];
  const before=JSON.stringify(logs);
  assert.throws(() => planner.assertNoOverlap(logs,planner.period('2026-09-29')),/overlaps Check 23/);
  assert.throws(() => planner.assertNoOverlap(logs,planner.period('2026-10-10')),/overlaps/);
  assert.doesNotThrow(() => planner.assertNoOverlap(logs,planner.period('2026-10-13')));
  assert.equal(JSON.stringify(logs),before);
});
test('invalid calendar dates are rejected instead of rolled into another month', () => {
  for(const date of ['2026-02-30','2026-13-01','2026-00-02','2026-04-31']) {
    assert.equal(scheduler.parseDateOnly(date),null);
    assert.throws(() => planner.period(date));
  }
});
