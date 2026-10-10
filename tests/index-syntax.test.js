const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('every inline script in index.html parses', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  assert.ok(scripts.length > 0);
  scripts.forEach((source, index) => assert.doesNotThrow(() => new vm.Script(source, { filename: `index-inline-${index}.js` })));
});

test('the scheduling and design assets are loaded', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /<script src="bill-scheduler\.js\?v=0\.38\.0"><\/script>/);
  assert.match(html, /<script src="savings-forecast\.js\?v=0\.38\.0"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="design-system\.css\?v=0\.38\.0"\/>/);
});

test('settings includes expandable release notes for recent releases', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /id="patchNotesList"/);
  assert.match(html, /version: 'v0\.37\.2'/);
  assert.match(html, /version: 'v0\.37\.1'/);
  assert.match(html, /version: 'v0\.37'/);
  assert.match(html, /version: 'v0\.36'/);
  assert.match(html, /version: 'v0\.35'/);
  assert.match(html, /version: 'v0\.34'/);
  assert.match(html, /function renderPatchNotes\(\)/);
});

test('the refined workspace shell and navigation are present', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /class="container app-shell/);
  assert.match(html, /class="tabs app-nav"/);
  assert.match(html, /class="app-nav-heading hidden"/);
  assert.match(html, /id="workspace-shell-critical"/);
  assert.match(html, /v0\.38\.0 &mdash; Paydays &amp; Scenarios/);
});

test('check log cards use the compact desktop structure', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /class="check-log-header/);
  assert.match(html, /class="check-log-tools/);
  assert.match(html, /class="check-log-amount/);
  assert.match(html, /class="check-log-summary/);
});

test('savings forecast tab is wired to shared state and rendering', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /data-tab="savings-forecast-tab"/);
  assert.match(html, /id="savings-forecast-tab"/);
  assert.match(html, /savingsForecast: SavingsForecast\.createDefaultState\(2026\)/);
  assert.match(html, /function renderSavingsForecast\(\)/);
  assert.match(html, /addEventListener\('focusout'.*updateSavingsForecastFromControl/s);
});
