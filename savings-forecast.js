(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SavingsForecast = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const DEFAULT_CONTRIBUTIONS = [
    { id: 'hf-0', month: 2, label: 'Check 2: First Savings', planned: 1750, actual: 1000, bonus: false },
    { id: 'hf-1', month: 3, label: 'Check 1 Savings', planned: 2250, actual: 2200, bonus: false },
    { id: 'hf-2', month: 3, label: 'Check 2 Savings', planned: 1750, actual: null, bonus: false },
    { id: 'hf-3', month: 4, label: 'Check 1 Savings', planned: 2250, actual: null, bonus: false },
    { id: 'hf-4', month: 4, label: 'Check 2 Savings', planned: 1750, actual: null, bonus: false },
    { id: 'hf-5', month: 5, label: 'Check 1 Savings', planned: 2250, actual: null, bonus: false },
    { id: 'hf-6', month: 5, label: 'Check 2 Savings', planned: 1750, actual: null, bonus: false },
    { id: 'hf-7', month: 6, label: 'Check 1 Savings', planned: 2250, actual: null, bonus: false },
    { id: 'hf-8', month: 6, label: 'Check 2 Savings', planned: 1750, actual: null, bonus: false },
    { id: 'hf-9', month: 6, label: 'Bonus Check 3', planned: 3000, actual: null, bonus: true },
    { id: 'hf-10', month: 7, label: 'Check 1 Savings', planned: 2250, actual: null, bonus: false },
    { id: 'hf-11', month: 7, label: 'Check 2 Savings', planned: 1750, actual: null, bonus: false },
    { id: 'hf-12', month: 8, label: 'Check 1 Savings', planned: 2250, actual: null, bonus: false },
    { id: 'hf-13', month: 8, label: 'Check 2 Savings', planned: 1750, actual: null, bonus: false },
    { id: 'hf-14', month: 9, label: 'Check 1 Savings', planned: 2250, actual: null, bonus: false },
    { id: 'hf-15', month: 9, label: 'Check 2 Savings', planned: 1750, actual: null, bonus: false },
    { id: 'hf-16', month: 10, label: 'Check 1 Savings', planned: 2250, actual: null, bonus: false },
    { id: 'hf-17', month: 10, label: 'Check 2 Savings', planned: 1750, actual: null, bonus: false },
    { id: 'hf-18', month: 11, label: 'Check 1 Savings', planned: 1750, actual: null, bonus: false },
    { id: 'hf-19', month: 11, label: 'Check 2 Savings', planned: 2250, actual: null, bonus: false },
    { id: 'hf-20', month: 11, label: 'Bonus Check 3', planned: 3000, actual: null, bonus: true }
  ];

  function finiteNumber(value, fallback = 0) {
    const parsed = typeof value === 'string' ? Number(value.replace(/[$,\s]/g, '')) : Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalizeActual(value) {
    if (value === null || value === undefined || value === '') return null;
    return finiteNumber(value, null);
  }

  function createExampleState(year = 2026) {
    const safeYear = Number.isInteger(Number(year)) ? Number(year) : 2026;
    return {
      version: 1,
      year: safeYear,
      startingBalance: 0,
      additionalIn: 0,
      additionalOut: 0,
      activeGoalId: 'house-fund',
      goals: [
        { id: 'house-fund', name: 'House Fund', target: 40000, targetDate: `${safeYear}-12-31` }
      ],
      contributions: DEFAULT_CONTRIBUTIONS.map(item => ({ ...item }))
    };
  }

  function createDefaultState(year = new Date().getFullYear()) {
    const example = createExampleState(year);
    return { ...example, activeGoalId: 'new-goal', goals: [{ id: 'new-goal', name: 'Your savings goal', target: 0, targetDate: `${example.year}-12-31` }], contributions: [] };
  }

  function normalizeState(input, fallbackYear = 2026) {
    const base = createDefaultState(fallbackYear);
    if (!input || typeof input !== 'object') return base;

    const year = Number.isInteger(Number(input.year)) ? Number(input.year) : base.year;
    const goals = Array.isArray(input.goals) && input.goals.length
      ? input.goals.map((goal, index) => ({
          id: String(goal?.id || `goal-${index + 1}`),
          name: String(goal?.name || `Goal ${index + 1}`).trim() || `Goal ${index + 1}`,
          target: Math.max(0, finiteNumber(goal?.target, 0)),
          targetDate: /^\d{4}-\d{2}-\d{2}$/.test(String(goal?.targetDate || ''))
            ? String(goal.targetDate)
            : `${year}-12-31`
        }))
      : base.goals;

    const contributions = Array.isArray(input.contributions)
      ? input.contributions.map((item, index) => ({
          id: String(item?.id || `saving-${index + 1}`),
          month: Math.min(11, Math.max(0, Math.trunc(finiteNumber(item?.month, 0)))),
          label: String(item?.label || 'Savings contribution').trim() || 'Savings contribution',
          planned: Math.max(0, finiteNumber(item?.planned, 0)),
          actual: normalizeActual(item?.actual),
          bonus: Boolean(item?.bonus)
        }))
      : base.contributions;

    const activeGoalId = goals.some(goal => goal.id === String(input.activeGoalId))
      ? String(input.activeGoalId)
      : goals[0].id;

    return {
      version: 1,
      year,
      startingBalance: finiteNumber(input.startingBalance, 0),
      additionalIn: finiteNumber(input.additionalIn, 0),
      additionalOut: Math.max(0, finiteNumber(input.additionalOut, 0)),
      activeGoalId,
      goals,
      contributions
    };
  }

  function calculateForecast(input) {
    const data = normalizeState(input, input?.year || 2026);
    const openingNet = data.startingBalance + data.additionalIn - data.additionalOut;
    let actualRunning = openingNet;
    let projectedRunning = openingNet;
    let plannedRunning = openingNet;

    const ordered = data.contributions
      .map((item, index) => ({ ...item, sourceIndex: index }))
      .sort((a, b) => a.month - b.month || a.sourceIndex - b.sourceIndex);

    const timeline = ordered.map(item => {
      plannedRunning += item.planned;
      if (item.actual !== null) actualRunning += item.actual;
      projectedRunning += item.actual !== null ? item.actual : item.planned;
      return {
        ...item,
        actualRunning,
        projectedRunning,
        plannedRunning,
        variance: item.actual === null ? null : item.actual - item.planned
      };
    });

    const goalStatuses = data.goals.map(goal => {
      let hit = openingNet >= goal.target ? { month: null, label: 'Starting balance' } : null;
      if (!hit) {
        for (const item of timeline) {
          if (item.projectedRunning >= goal.target) {
            hit = { month: item.month, label: item.label };
            break;
          }
        }
      }
      return {
        ...goal,
        actualPercent: goal.target > 0 ? (actualRunning / goal.target) * 100 : 100,
        projectedPercent: goal.target > 0 ? (projectedRunning / goal.target) * 100 : 100,
        actualGap: Math.max(0, goal.target - actualRunning),
        projectedGap: Math.max(0, goal.target - projectedRunning),
        projectedHit: hit
      };
    });

    const months = MONTHS.map((name, month) => {
      const entries = timeline.filter(item => item.month === month);
      return {
        month,
        name,
        entries,
        planned: entries.reduce((sum, item) => sum + item.planned, 0),
        actual: entries.reduce((sum, item) => sum + (item.actual ?? 0), 0),
        projected: entries.reduce((sum, item) => sum + (item.actual ?? item.planned), 0)
      };
    });

    return {
      data,
      openingNet,
      timeline,
      months,
      goalStatuses,
      actualTotal: actualRunning,
      projectedTotal: projectedRunning,
      plannedTotal: plannedRunning,
      pendingCount: timeline.filter(item => item.actual === null).length
    };
  }

  function calculateYearProgress(year, now = new Date()) {
    const start = new Date(Number(year), 0, 1);
    const end = new Date(Number(year) + 1, 0, 1);
    const value = now instanceof Date ? now : new Date(now);
    if (Number.isNaN(value.getTime())) return 0;
    return Math.min(100, Math.max(0, ((value - start) / (end - start)) * 100));
  }

  return {
    MONTHS,
    createDefaultState,
    createExampleState,
    normalizeState,
    calculateForecast,
    calculateYearProgress
  };
});
