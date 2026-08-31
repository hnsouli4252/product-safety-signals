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

test('pre-recall evidence is independent, harm-based, and strictly predates action', () => {
  const leads = data.records.filter(record => record.preRecallNews);
  assert.equal(leads.length, 1);
  for (const record of leads) {
    assert.ok(new Date(record.preRecallNews.date) < new Date(record.date));
    assert.equal(record.preRecallNews.articleType, 'Independent consumer-harm coverage');
    assert.ok(record.preRecallNews.leadDays > 0);
    assert.match(record.preRecallNews.url, /^https:\/\//);
    assert.ok(record.preRecallNews.rationale);
    assert.ok(record.preRecallNews.boundary);
  }
  assert.deepEqual(data.methodology.recallMetrics, {
    qualifiedMatches: 1,
    unmatchedRecalls: 51,
    averageLeadDays: 206,
    longestLeadDays: 206
  });
});

test('recall-announcement coverage is excluded from all timing and feed metrics', () => {
  const excluded = data.records.flatMap(record => record.excludedCoverage.map(article => ({ record, article })));
  assert.equal(excluded.length, 7);
  assert.equal(data.methodology.excludedRecallCoverageCount, 7);
  for (const { record, article } of excluded) {
    assert.ok(new Date(article.date) >= new Date(record.date));
    assert.equal(article.articleType, 'Recall-announcement coverage');
    assert.match(article.exclusionReason, /Excluded from timing and the 30-day harm feed/);
  }
});

test('early warnings are descending and distinguish Recall from Safety alert', () => {
  assert.deepEqual(data.earlyWarnings.map(item => item.leadDays), [497, 206]);
  assert.deepEqual(new Set(data.earlyWarnings.map(item => item.actionType)), new Set(['Recall', 'Safety alert']));
  const squishy = data.earlyWarnings.find(item => item.id === 'squishy-toys-safety-alert');
  assert.equal(squishy.actionType, 'Safety alert');
  assert.equal(squishy.leadDays, 497);
  assert.match(squishy.boundary, /not a recall/i);
  assert.match(squishy.boundary, /does not name NeeDoh/i);
});

test('30-day feed retains qualified independent harm reporting only', () => {
  for (const lead of data.recentIndependentNews) {
    const date = new Date(lead.date);
    assert.ok(date >= new Date('2026-08-01T00:00:00Z'));
    assert.ok(date <= new Date('2026-08-30T23:59:59Z'));
    assert.equal(lead.articleType, 'Independent consumer-harm coverage');
    assert.doesNotMatch(lead.title, /recall alert|recalled/i);
  }
  assert.equal(data.recentIndependentNews.length, 0);
});
