(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BillScheduler = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const DAY_MS = 86400000;
  const INTERVAL_DAYS = { weekly: 7, biweekly: 14 };
  const INTERVAL_MONTHS = {
    monthly: 1,
    bimonthly: 2,
    quarterly: 3,
    semiannual: 6,
    annual: 12
  };

  function parseDateOnly(value) {
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return null;
      return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    }
    if (!value) return null;
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
      return date.getFullYear() === Number(match[1]) && date.getMonth() === Number(match[2]) - 1 && date.getDate() === Number(match[3]) ? date : null;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }

  function formatDateYMD(value) {
    const date = parseDateOnly(value);
    if (!date) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function daysInMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
  }

  function occurrenceAt(firstDueDate, interval, index, dueDay) {
    const anchor = parseDateOnly(firstDueDate);
    if (!anchor || index < 0) return null;
    if (INTERVAL_DAYS[interval]) {
      const result = new Date(anchor);
      result.setDate(result.getDate() + INTERVAL_DAYS[interval] * index);
      return result;
    }

    const monthStep = INTERVAL_MONTHS[interval] || 1;
    const absoluteMonth = anchor.getFullYear() * 12 + anchor.getMonth() + monthStep * index;
    const year = Math.floor(absoluteMonth / 12);
    const month = ((absoluteMonth % 12) + 12) % 12;
    const day = Math.min(Number(dueDay) >= 1 && Number(dueDay) <= 31 ? Math.trunc(Number(dueDay)) : anchor.getDate(), daysInMonth(year, month));
    return new Date(year, month, day);
  }

  function estimateStartingIndex(anchor, interval, rangeStart) {
    if (rangeStart <= anchor) return 0;
    if (INTERVAL_DAYS[interval]) {
      return Math.max(0, Math.floor((rangeStart - anchor) / DAY_MS / INTERVAL_DAYS[interval]) - 1);
    }
    const monthStep = INTERVAL_MONTHS[interval] || 1;
    const monthDifference = (rangeStart.getFullYear() - anchor.getFullYear()) * 12 + rangeStart.getMonth() - anchor.getMonth();
    return Math.max(0, Math.floor(monthDifference / monthStep) - 1);
  }

  function getOccurrencesInRange(firstDueDate, interval, startDate, endDate, dueDay) {
    const anchor = parseDateOnly(firstDueDate);
    const start = parseDateOnly(startDate);
    const end = parseDateOnly(endDate);
    if (!anchor || !start || !end || end < start) return [];

    const occurrences = [];
    let index = estimateStartingIndex(anchor, interval, start);
    for (let iterations = 0; iterations < 20000; iterations++, index++) {
      const candidate = occurrenceAt(anchor, interval, index, dueDay);
      if (!candidate || candidate > end) break;
      if (candidate >= start) occurrences.push(candidate);
    }
    return occurrences;
  }

  function getNextDueDate(firstDueDate, interval, afterDate, dueDay) {
    const anchor = parseDateOnly(firstDueDate);
    const reference = parseDateOnly(afterDate || new Date());
    if (!anchor || !reference) return null;
    let index = estimateStartingIndex(anchor, interval, reference);
    for (let iterations = 0; iterations < 20000; iterations++, index++) {
      const candidate = occurrenceAt(anchor, interval, index, dueDay);
      if (candidate && candidate >= reference) return candidate;
    }
    return null;
  }

  function getOccurrenceOnOrBefore(firstDueDate, interval, dateValue, dueDay) {
    const anchor = parseDateOnly(firstDueDate);
    const reference = parseDateOnly(dateValue);
    if (!anchor || !reference) return null;
    if (reference < anchor) return new Date(anchor);
    let index = estimateStartingIndex(anchor, interval, reference);
    let previous = new Date(anchor);
    for (let iterations = 0; iterations < 20000; iterations++, index++) {
      const candidate = occurrenceAt(anchor, interval, index, dueDay);
      if (!candidate || candidate > reference) break;
      previous = candidate;
    }
    return previous;
  }

  function advanceDate(dateValue, interval) {
    return occurrenceAt(dateValue, interval, 1);
  }

  function normalizeName(value) {
    return String(value || '').trim().toLowerCase();
  }

  function reconcileScheduledItems(log, schedule) {
    if (!log || !Array.isArray(log.items)) return false;
    const sourceType = String(schedule.sourceType || 'recurring');
    const sourceId = String(schedule.sourceId ?? '');
    const legacyNames = new Set([schedule.name, ...(schedule.previousNames || [])].map(normalizeName).filter(Boolean));
    const expectedDates = [...new Set((schedule.dates || []).map(formatDateYMD).filter(Boolean))].sort();
    const original = JSON.stringify(log.items);

    const matches = item => {
      if (item.scheduleSourceType) {
        return item.scheduleSourceType === sourceType && String(item.scheduleSourceId ?? '') === sourceId;
      }
      return legacyNames.has(normalizeName(item.bill));
    };

    const matched = log.items.filter(matches);
    const used = new Set();
    for (const dueDate of expectedDates) {
      let item = matched.find(candidate => !used.has(candidate) && candidate.dueDate === dueDate);
      if (!item) item = matched.find(candidate => !used.has(candidate) && !candidate.paid);
      if (!item) {
        const newItemId = log.items.length > 0 ? Math.max(...log.items.map(candidate => Number(candidate.id) || 0)) + 1 : 1;
        item = { id: newItemId, paid: false };
        log.items.push(item);
        matched.push(item);
      }
      used.add(item);
      // A settled occurrence is a financial record, not a live schedule template.
      if (item.paid) {
        // Attach identity to legacy rows so a rename cannot duplicate the settled occurrence.
        item.scheduleSourceType = sourceType;
        item.scheduleSourceId = schedule.sourceId;
        continue;
      }
      item.bill = schedule.name;
      item.cost = Number(schedule.amount) || 0;
      item.category = schedule.category || item.category || 'Other';
      item.dueDate = dueDate;
      item.scheduleSourceType = sourceType;
      item.scheduleSourceId = schedule.sourceId;
    }

    log.items = log.items.filter(item => !matches(item) || item.paid || used.has(item));
    return original !== JSON.stringify(log.items);
  }

  return {
    advanceDate,
    formatDateYMD,
    getNextDueDate,
    getOccurrenceOnOrBefore,
    getOccurrencesInRange,
    occurrenceAt,
    parseDateOnly,
    reconcileScheduledItems
  };
});
