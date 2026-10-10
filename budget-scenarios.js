(function(root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./bill-scheduler') : root.BillScheduler);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BudgetScenarios = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(scheduler) {
  // Read-only projections. No check logs, balances, or payment records are written.
  function project(tracker, options) {
    const start = scheduler.parseDateOnly(options.startDate);
    if (!start) throw new Error('Choose a valid projection month.');
    const excluded = new Set((options.excludedIds || []).map(String));
    return Array.from({length: 3}, (_, index) => {
      const first = new Date(start.getFullYear(), start.getMonth() + index, 1);
      const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
      let baseline = 0, scenario = 0, categoryTotal = 0;
      (tracker.bills || []).forEach(bill => {
        // Legacy monthly bills have only dueDay; include them without inventing a persisted anchor.
        const legacyDay = Math.min(Math.max(1, Number(bill.dueDay) || 1), last.getDate());
        const anchor = bill.firstDueDate || scheduler.formatDateYMD(new Date(first.getFullYear(), first.getMonth(), legacyDay));
        const count = scheduler.getOccurrencesInRange(anchor, bill.recurrenceInterval || 'monthly', first, last, bill.dueDay).length;
        const amount = count * (Number(bill.amount) || 0);
        baseline += amount;
        if (!excluded.has(String(bill.id))) {
          scenario += amount;
          if (bill.category === options.category) categoryTotal += amount;
        }
      });
      (tracker.oneTimeExpenses || []).forEach(expense => {
        const date = scheduler.parseDateOnly(expense.date);
        if (date && date >= first && date <= last) {
          const amount = Number(expense.amount) || 0;
          baseline += amount; scenario += amount;
          if (expense.category === options.category) categoryTotal += amount;
        }
      });
      if (options.category && options.categoryAmount !== '' && options.categoryAmount != null) scenario += Math.max(0, Number(options.categoryAmount) || 0) - categoryTotal;
      const income = Math.max(0, Number(options.monthlyIncome) || 0);
      return { month: scheduler.formatDateYMD(first), baseline, scenario, baselineLeft: income - baseline, scenarioLeft: income - scenario, difference: baseline - scenario };
    });
  }
  return { project };
});
