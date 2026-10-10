(function(root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./bill-scheduler') : root.BillScheduler);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PaycheckPlanner = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function(scheduler) {
  function nextPayday(startDate, cadence = 'biweekly', earlyAccessDays = 0) {
    const start = scheduler.parseDateOnly(startDate);
    if (!start) throw new Error('Select a valid paycheck date.');
    if (cadence !== 'semimonthly') {
      start.setDate(start.getDate() + 14);
      return scheduler.formatDateYMD(start);
    }
    const y = start.getFullYear(), m = start.getMonth();
    return nextPayInfo(startDate, earlyAccessDays).expectedDate;
  }
  function nextPayInfo(afterDate, earlyAccessDays = 0, inclusive = false) {
    const start = scheduler.parseDateOnly(afterDate);
    if (!start) throw new Error('Select a valid paycheck date.');
    const early = Math.min(7, Math.max(0, Math.trunc(Number(earlyAccessDays) || 0)));
    const y = start.getFullYear(), m = start.getMonth();
    for (let offset = 0; offset < 3; offset++) {
      const month = new Date(y, m + offset, 1);
      const lastDay = new Date(y, m + offset + 1, 0).getDate();
      for (const day of [15, Math.min(30, lastDay)]) {
        const date = new Date(month.getFullYear(), month.getMonth(), day);
        const expected = new Date(date); expected.setDate(expected.getDate() - early);
        if (expected > start || (inclusive && expected.getTime() === start.getTime())) return {scheduledDate: scheduler.formatDateYMD(date), expectedDate: scheduler.formatDateYMD(expected), earlyAccessDays: early};
      }
    }
  }
  function period(startDate, cadence, explicitNextDate, earlyAccessDays = 0) {
    const start = scheduler.parseDateOnly(startDate);
    const next = scheduler.parseDateOnly(explicitNextDate || nextPayday(startDate, cadence, earlyAccessDays));
    if (!start || !next || next <= start) throw new Error('Next paycheck must be after this paycheck.');
    const end = new Date(next); end.setDate(end.getDate() - 1);
    return { startDate: scheduler.formatDateYMD(start), endDate: scheduler.formatDateYMD(end) };
  }
  function assertNoOverlap(logs, range) {
    const overlap = logs.find(log => log.startDate && log.endDate && log.startDate <= range.endDate && log.endDate >= range.startDate);
    if (overlap) throw new Error(`This period overlaps ${overlap.name || 'an existing check'}. Open that check or choose a later date.`);
  }
  function suggestNextStart(logs, cadence, today = new Date(), earlyAccessDays = 0) {
    const candidates = logs.map(log => {
      const end = scheduler.parseDateOnly(log.endDate);
      if (end) { end.setDate(end.getDate() + 1); return scheduler.formatDateYMD(end); }
      return scheduler.parseDateOnly(log.startDate) ? nextPayday(log.startDate, cadence, earlyAccessDays) : '';
    }).filter(Boolean).sort();
    return candidates.at(-1) || scheduler.formatDateYMD(today);
  }
  return { nextPayday, nextPayInfo, period, assertNoOverlap, suggestNextStart };
});
