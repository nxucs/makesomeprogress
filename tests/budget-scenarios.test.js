const test = require('node:test');
const assert = require('node:assert/strict');
const scenarios = require('../budget-scenarios');
const tracker={bills:[{id:1,name:'Car1',category:'Transportation',amount:500,firstDueDate:'2026-01-31',recurrenceInterval:'monthly'},{id:2,name:'Weekly food',category:'Food',amount:100,firstDueDate:'2026-01-01',recurrenceInterval:'weekly'}],oneTimeExpenses:[{date:'2026-02-15',amount:80,category:'Transportation'}]};

test('legacy due-day-only bills remain included and frozen financial records are never mutated', () => {
  const bills=Object.freeze([Object.freeze({id:3,name:'Legacy rent',dueDay:31,amount:1000,category:'Housing'})]);
  const rows=scenarios.project(Object.freeze({bills,oneTimeExpenses:Object.freeze([])}),{startDate:'2026-02-01',monthlyIncome:3000});
  assert.deepEqual(rows.map(row=>row.baseline),[1000,1000,1000]);
});
test('sold-car exclusion and category override are read-only projections', () => {
  const original=JSON.stringify(tracker);
  const rows=scenarios.project(tracker,{startDate:'2026-01-01',monthlyIncome:3000,excludedIds:[1]});
  assert.equal(rows.length,3);
  assert.equal(rows[0].difference,500);
  assert.equal(rows[1].difference,500);
  const overrides=scenarios.project(tracker,{startDate:'2026-01-01',monthlyIncome:3000,category:'Transportation',categoryAmount:1000});
  assert.equal(overrides[0].difference,-500);
  assert.equal(overrides[1].difference,-420);
  assert.equal(JSON.stringify(tracker),original);
});
