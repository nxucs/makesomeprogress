# Direct Log Check regression

Run `npm run test:browser` with Playwright installed. `PLAYWRIGHT_MODULE` may point to an existing installed Playwright module; `CHROME_PATH` may override the browser executable. Windows defaults to installed Google Chrome; other hosts use Playwright Chromium.

The fixture preserves the exact three unrepaired legacy bill configurations and Check 23 date identity, plus a synthetic paid history row and an unrelated genuine weekly expense. It imports through the actual file control, clicks Log Check without a repair, then verifies sync and reload. Financial APIs are blocked, and the browser uses a fresh disposable profile. No real exports or credentials are committed.

The separate development evidence also runs the same path using the complete, unmodified September 29 export kept outside the repository, verifies all 23 previous histories, and tests an already-bad Check 24 followed by direct logging of the next check.
