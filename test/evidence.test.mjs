import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const data = JSON.parse(await readFile(new URL('../data/august-2026-recalls.json', import.meta.url)));

test('contains every August recall in the bounded official set', () => {
  assert.equal(data.records.length, 52);
  assert.deepEqual([...new Set(data.records.map(r => r.date))].sort(), [
    'August 06, 2026', 'August 13, 2026', 'August 20, 2026', 'August 27, 2026'
  ]);
});

test('every recall preserves source and boundary fields', () => {
  for (const record of data.records) {
    assert.match(record.officialUrl, /^https:\/\/www\.cpsc\.gov\/Recalls\/2026\//);
    assert.ok(record.product);
    assert.ok(record.hazard);
    assert.ok(record.incidents);
    assert.ok(record.reportBoundary);
    assert.equal(record.reportDate, null);
  }
});

test('news leads are inside the August 1-30 window and transparently scored', () => {
  const leads = data.records.filter(record => record.news);
  assert.equal(leads.length, 7);
  for (const { news } of leads) {
    const date = new Date(news.date);
    assert.ok(date >= new Date('2026-08-01T00:00:00Z'));
    assert.ok(date <= new Date('2026-08-30T23:59:59Z'));
    assert.ok(news.confidence >= 95 && news.confidence <= 100);
    assert.match(news.url, /^https:\/\//);
    assert.ok(news.rationale);
  }
});
