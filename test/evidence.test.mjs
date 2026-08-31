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
    assert.ok(Object.hasOwn(record, 'reportDate'));
    assert.ok(Object.hasOwn(record, 'reportPublicationDate'));
    assert.ok(Object.hasOwn(record, 'reportNumber'));
    assert.ok(Object.hasOwn(record, 'reportUrl'));
  }
});

test('SaferProducts refresh preserves exact-product report provenance', () => {
  const matches = data.records.filter(record => record.reportMatch === 'exact_product');
  assert.equal(data.saferProductsExactMatchCount, 10);
  assert.equal(data.methodology.saferProductsExactMatchCount, 10);
  assert.equal(matches.length, 10);
  assert.equal(data.saferProductsExportRetrieved, 'August 31, 2026');
  assert.match(data.saferProductsExport, /^https:\/\/www\.saferproducts\.gov\/SPDB\.zip$/);
  for (const record of matches) {
    assert.ok(!Number.isNaN(new Date(record.reportDate).valueOf()));
    assert.ok(['pre_recall', 'post_recall'].includes(record.reportTiming));
    assert.ok(record.reportPublicationDate);
    assert.match(record.reportNumber, /^20\d{6}-[A-Z0-9]+-\d+$/);
    assert.match(record.reportUrl, /^https:\/\/www\.saferproducts\.gov\/PublicSearch\/Result\?id=\d+&handler=Detail$/);
    assert.ok(record.reportSummary);
    assert.ok(record.reportSeverity);
  }
  assert.equal(matches.filter(record => record.reportTiming === 'pre_recall').length, 9);
  assert.equal(matches.filter(record => record.reportTiming === 'post_recall').length, 1);
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
  assert.deepEqual(data.earlyWarnings.map(item => item.leadDays), [497, 206, 58]);
  assert.deepEqual(new Set(data.earlyWarnings.map(item => item.actionType)), new Set(['Recall', 'Safety alert']));
  const squishy = data.earlyWarnings.find(item => item.id === 'squishy-toys-safety-alert');
  assert.equal(squishy.actionType, 'Safety alert');
  assert.equal(squishy.leadDays, 497);
  assert.match(squishy.boundary, /not a recall/i);
  assert.match(squishy.boundary, /does not name NeeDoh/i);
  assert.equal(squishy.supportingSources.length, 2);
  assert.ok(squishy.supportingSources.every(source => new Date(source.date) < new Date(squishy.actionDate)));
  const cuisinart = data.earlyWarnings.find(item => item.id === 'wire-grill-brush-cuisinart-expansion');
  assert.equal(cuisinart.actionType, 'Recall');
  assert.equal(cuisinart.actionLabel, 'Recall expansion');
  assert.equal(cuisinart.leadDays, 58);
  assert.match(cuisinart.boundary, /did not identify the brush brand or model/i);
  assert.match(cuisinart.boundary, /excluded from exact\/probable-product recall averages/i);
});

test('past-year feed retains qualified U.S. independent harm reporting only', () => {
  for (const lead of data.pastYearIndependentNews) {
    const date = new Date(lead.date);
    assert.ok(date >= new Date('2025-08-31T00:00:00Z'));
    assert.ok(date <= new Date('2026-08-30T23:59:59Z'));
    assert.equal(lead.articleType, 'Independent consumer-harm coverage');
    assert.equal(lead.country, 'United States');
    assert.doesNotMatch(lead.title, /recall alert|recalled/i);
    assert.ok(['Pre-action', 'Post-action', 'No linked action'].includes(lead.timingStatus));
  }
  assert.equal(data.pastYearIndependentNews.length, 25);
  assert.equal(data.methodology.pastYearQualifiedNewsCount, 25);
  assert.equal(data.methodology.harmNewsGeography, 'United States incidents only');
  assert.equal(new Set(data.pastYearIndependentNews.map(lead => lead.category)).size, 15);
  assert.equal(data.methodology.pastYearCategoryCount, 15);
  assert.ok(data.pastYearIndependentNews.every(lead => lead.boundary && lead.sourceBasis && lead.harm));
  assert.ok(data.pastYearIndependentNews.some(lead => lead.timingStatus === 'Pre-action'));
  assert.ok(data.pastYearIndependentNews.some(lead => lead.timingStatus === 'Post-action'));
  assert.ok(data.pastYearIndependentNews.some(lead => lead.timingStatus === 'No linked action'));
});

test('no-linked-action highlights are bounded, reviewable, and preserve the recent subset', () => {
  const noLinked = data.pastYearIndependentNews.filter(lead => lead.timingStatus === 'No linked action');
  assert.equal(noLinked.length, 16);
  assert.equal(data.methodology.noLinkedActionCount, 16);
  assert.equal(data.methodology.noLinkedActionAsOf, 'August 30, 2026');
  assert.ok(noLinked.every(lead => lead.actionSearchBoundary && lead.analystPriority));
  assert.ok(noLinked.every(lead => /No matching product-specific CPSC Recall or Safety Alert was located/.test(lead.actionSearchBoundary)));

  assert.equal(data.recentUnlinkedSignals.length, 4);
  assert.equal(data.methodology.recentUnlinkedSignalCount, 4);
  const fullFeedUrls = new Set(data.pastYearIndependentNews.map(lead => lead.url));
  for (const signal of data.recentUnlinkedSignals) {
    const date = new Date(signal.date);
    assert.ok(date >= new Date('2026-08-17T00:00:00Z'));
    assert.ok(date <= new Date('2026-08-30T23:59:59Z'));
    assert.equal(signal.country, 'United States');
    assert.equal(signal.timingStatus, 'No linked action');
    assert.equal(signal.status, 'No linked CPSC action located in review');
    assert.equal(signal.asOf, 'August 30, 2026');
    assert.ok(fullFeedUrls.has(signal.url));
  }
});
