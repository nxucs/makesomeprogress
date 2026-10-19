# Bill Cycles — v0.40.0

## Paycheck waterfall

The primary view now follows confirmed paychecks through a linear waterfall of bill allocations and a continuous calendar of paydays and due dates. Each step shows the allocation, remaining paycheck balance, and any bill amount carried forward. A bill may receive funding from several checks. Allocation snapshots preserve the amount still needed at that historical step; the due-date cards show the current total.

Paychecks are entered manually or explicitly copied from an existing Check Log after confirming amount/date. Adding or logging a paycheck allocates nothing. A due-order preview can be adjusted with priorities, include/skip controls and maximum amounts. Editing any control invalidates the preview. Applying validates the current balances again, then records earmarks with their original paycheck provenance. It does not mark bills paid or change Check Logs.

Optional `billCycles.waterfall` version 1 adds paycheck and allocation arrays alongside existing version-1 cycle data. Existing unsourced funding is preserved and reduces the remaining need; no source is inferred. Batch undo returns funds to the original paycheck while preserving allocations from other checks and unrelated manual funding. Paid occurrences block batch reversal until payment is explicitly undone. Manual funding edits cannot erase sourced allocations, and paycheck corrections cannot reduce the check below its allocated total. Repeated source reuse, stale previews and duplicate batches are rejected. Original imports/exports, backups, account isolation and persistence remain compatible.

`npm run test:waterfall-browser` verifies the synthetic $5000 example at desktop/mobile sizes, due-order partial funding, priority/cap/skip controls, preview-only behavior, storage failure, a second check completing the partial bill, independent source undo, reload/export/import and unchanged Check Logs. `npm run check` now passes 114 source tests. The original Bill Cycles and full Check Log browser suites also remain part of release verification.

Bill Cycles is an additional tab. It does not replace Check Logs or Expenses, and it does not feed the existing expense totals, bank matching, calendar synchronization, or paycheck allocation routines. Earmarking and marking paid are manual records, with no transfer or payment integration.

## Data and compatibility

- Optional `state.billCycles` version 1 contains definitions, occurrence snapshots, action history, and the selected schedule horizon. Older imports need no migration and are not changed merely by opening the tab.
- Users explicitly reuse an existing obligation or enter a confirmed amount/date/cadence. Reuse copies a definition; it never modifies the source. Confirmed legacy schedules use the existing v0.38.4 cadence resolver. Mortgage Holding names and per-check reserves cannot be reused as obligations; no mortgage amount is inferred from them.
- Stable occurrence keys combine the definition UUID and recurrence index. Generating through a date is idempotent; paid and corrected occurrences remain occupied. Conflicting corrected dates block generation or undo rather than creating duplicates.
- Month-based recurrence retains the original day and clamps to shorter months, including leap February. Reusing an existing month-end bill retains its known due-day anchor. Weekly/biweekly recurrence uses date-only UTC calculations.
- Occurrences snapshot name, amount, and due date. Future amount changes apply only to newly generated occurrences. Pause/resume retains all scheduled records. Individual amount/date corrections and funding/payment actions have audit history and layered undo. Cadence is selected at creation; for a different cadence, pause the old definition, retain its history, and explicitly create a distinctly named definition.
- Earmarked totals use integer cents and may be corrected downward. Ready means fully earmarked. Paid requires an explicit action and actual payment date; it does not imply funding. Undo payment restores the prior manual funding total.
- Before the first Bill Cycles edit, the complete prior state is embedded as a JSON backup in `billCycles.backup`. Download backup retrieves it; the existing full Export includes current cycles and this backup. Persistence is verified before replacing in-memory state. A failed write leaves state untouched. Existing account isolation and Save behavior apply unchanged.
- Use the existing Save button to sync local changes. No credentials, database schema, security configuration, or external settings were changed for this feature. Older app versions may ignore the optional field; preserve a current export before deliberately downgrading.

## Verification

`npm run check` runs syntax checks and 114 source tests, including the original 95 tests. `npm run test:cycles-browser` exercises actual import/reuse/add/funding/Ready/payment/undo/correction/pause/schedule/reload/backup/export/import controls at desktop and mobile sizes in Los Angeles and Auckland timezones. It also verifies storage-failure safety, future amount snapshots, zero overflow/page errors, and unchanged existing financial records.

`npm run test:check-logs` runs the preserved direct legacy Log Check regression plus editor, genuine-weekly, paid/edited history, repeated sync/Add, repair preview/cancel, backup failure, repair apply/undo, holding boundaries, and reload regressions. Browser tests require Playwright (`PLAYWRIGHT_MODULE` can point to an existing installation) and Chrome (`CHROME_PATH` optional). They use disposable profiles, synthetic fixtures, and blocked financial APIs. Screenshots and JSON evidence go to `../evidence` or `EVIDENCE_DIR`. Set `APP_URL` for the Bill Cycles suite to verify the deployed static app with the same isolated flow.

Deployment follows the existing GitHub Pages workflow: normal fast-forward publication to `main`, root folder, followed by verification of the Pages build commit, public version, all local runtime asset SHA256 hashes, and the synthetic desktop/mobile flow. Release evidence and source archives are retained in the task workspace.
