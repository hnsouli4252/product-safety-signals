import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeRecallEntity, expandHarmTerms, generateQueries, progressiveWindows,
  classifyActualHarm, detectRecallCoverage, classifyCandidate, clusterIncidents,
  selectEarliestQualified, scoreActionMatch, SearchCache, applyReviewerOverride, runRecallSearch, VERSIONS
} from '../src/news-search/index.mjs';
import { evaluateBenchmark } from '../src/news-search/evaluate.mjs';

const data = JSON.parse(await readFile(new URL('../data/august-2026-recalls.json', import.meta.url)));
const fixture = JSON.parse(await readFile(new URL('./fixtures/news-search-benchmark.json', import.meta.url)));
const record = data.records.find(value => value.preRecallNews);
const entity = normalizeRecallEntity(record);

test('normalization, taxonomy expansion, and query generation create a bounded multi-strategy search', () => {
  assert.equal(entity.recallId, record.id);
  assert.ok(entity.productName);
  assert.ok(entity.productClass);
  assert.ok(entity.aliases.length);
  assert.ok(expandHarmTerms(entity).includes('hospitalized'));
  const queries = generateQueries(entity);
  assert.ok(queries.length >= 8 && queries.length <= 15);
  assert.ok(queries.some(query => /lawsuit injury/.test(query)));
  assert.ok(queries.some(query => /coroner|fire department/.test(query)));
  assert.equal(new Set(queries).size, queries.length);
  const windows = progressiveWindows(entity.recallDate);
  assert.equal(windows.length, 5);
  assert.ok(new Date(windows.at(-1).start) < new Date(windows[0].start));
});

test('actual-harm classifier rejects generic hazard language and recognizes real harm', () => {
  const generic = classifyActualHarm({ title: 'Product can cause injury or death', text: 'The item poses a serious hazard.' });
  assert.equal(generic.actualHarm, false);
  assert.equal(generic.genericOnly, true);
  const actual = classifyActualHarm({ title: 'Child died after dresser tipped over', text: 'The child was hospitalized and later died.' });
  assert.equal(actual.actualHarm, true);
  assert.ok(actual.deathCount >= 1);
});

test('recall coverage and post-recall articles cannot qualify as pre-recall evidence', () => {
  const coverage = detectRecallCoverage({ title: 'Product recalled Thursday', text: 'According to the recall notice, consumers should stop using it.' }, entity.recallDate);
  assert.equal(coverage.recallCoverage, true);
  const classified = classifyCandidate(entity, {
    url: 'https://example.test/recall', title: `${entity.productName} recalled Thursday`,
    publicationDate: entity.recallDate, text: 'CPSC announced the recall. A consumer was injured. Consumers should stop using the product.'
  });
  assert.equal(classified.qualification, 'recall_announcement');
});

test('Florida kitchen-playset death surfaces the KidKraft recall for review without falsely linking it', () => {
  const lead = {
    country: 'United States',
    product: 'Children’s kitchen playset',
    title: 'Florida toddler dies after getting head stuck in kitchen playset',
    harm: 'A three-year-old became trapped by the head in a toy kitchen and died from probable positional asphyxia.'
  };
  const action = {
    recallNumber: '25-415', date: '2025-07-31', brand: 'KidKraft', models: ['53411'],
    product: 'KidKraft Farm to Table Model Play Kitchen',
    hazard: 'Children’s clothing can get caught on accessory hooks, posing strangulation and asphyxia hazards.',
    incidents: 'A toddler died after his shirt caught on a hook while crawling through the rear opening.'
  };
  const match = scoreActionMatch(lead, action);
  assert.equal(match.matchTier, 'related_review');
  assert.equal(match.linkable, false);
  assert.ok(match.score <= 68);
  assert.equal(match.productMatchTier, 'category_hazard_review');
});

test('distinctive product wording and mechanism variants can produce a probable action match', () => {
  const match = scoreActionMatch({
    country: 'United States', product: 'Farm-to-table toy kitchen',
    title: 'Child strangled after shirt snagged inside play kitchen',
    harm: 'The child was asphyxiated when clothing caught on an accessory hook.'
  }, {
    recallNumber: '25-415', date: '2025-07-31', brand: 'KidKraft', models: ['53411'],
    product: 'KidKraft Farm to Table Model Play Kitchen',
    hazard: 'Clothing can get caught on hooks, posing strangulation and asphyxia hazards.'
  });
  assert.equal(match.matchTier, 'probable');
  assert.equal(match.linkable, true);
  assert.ok(match.identityAnchor);
});

test('similar injury language does not override conflicting product types or brands', () => {
  const wrongType = scoreActionMatch({
    country: 'United States', product: 'Children’s kitchen playset',
    title: 'Toddler head trapped in toy kitchen', harm: 'A child died from entrapment and asphyxia.'
  }, {
    date: '2026-08-13', product: 'Outdoor slide playsets', brand: 'Wenzhou Yidian',
    hazard: 'Head and neck entrapment can cause asphyxia and death.'
  });
  assert.equal(wrongType.matchTier, 'rejected');
  assert.ok(wrongType.conflicts.includes('product_type'));

  const wrongBrand = scoreActionMatch({
    country: 'United States', product: 'Anatex Country Living toy kitchen', brand: 'Anatex',
    title: 'Child trapped in play kitchen', harm: 'A child died from entrapment and asphyxia.'
  }, {
    date: '2025-07-31', product: 'KidKraft Farm to Table Model Play Kitchen', brand: 'KidKraft',
    hazard: 'Clothing can get caught on hooks, posing strangulation and asphyxia hazards.'
  });
  assert.equal(wrongBrand.matchTier, 'rejected');
  assert.ok(wrongBrand.conflicts.includes('brand'));
});

test('ranking, clustering, and earliest selection retain one incident and one earliest article', () => {
  const base = {
    title: `${entity.productName} burns consumer`,
    text: `A consumer suffered burns and was hospitalized after using the ${entity.productName}.`,
    publisher: 'Local TV', incidentDate: '2026-01-01', locations: ['Boston, MA']
  };
  const first = classifyCandidate(entity, { ...base, url: 'https://local.test/first', publicationDate: '2026-01-02' });
  const syndicated = classifyCandidate(entity, { ...base, url: 'https://wire.test/copy', publicationDate: '2026-01-03' });
  const clusters = clusterIncidents(entity.recallId, [first, syndicated]);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].articles.length, 2);
  const selected = selectEarliestQualified(clusters, entity.recallDate);
  assert.equal(selected.firstQualifiedArticle.url, first.url);
  assert.ok(selected.daysBeforeRecall > 0);
});

test('review overrides remain separate from model classifications', () => {
  const candidate = classifyCandidate(entity, {
    url: 'https://local.test/injury', title: `${entity.productName} injures consumer`,
    publicationDate: '2026-01-10', text: `A consumer was injured and hospitalized using the ${entity.productName}.`
  });
  const reviewed = applyReviewerOverride(candidate, { status: 'confirmed', reviewedAt: '2026-08-31T00:00:00Z', reviewerNote: 'Exact model and hospitalization confirmed.' });
  assert.equal(reviewed.review.status, 'confirmed');
  assert.equal(reviewed.modelQualification, candidate.qualification);
  assert.equal(candidate.review, undefined);
});

test('search run deduplicates retrieval, stops after a high-confidence window, and saves an audit record', async () => {
  const cache = new SearchCache();
  let searches = 0;
  const candidate = {
    url: 'https://local.test/known-harm', title: `${entity.productName} fire hospitalizes consumer`,
    publisher: 'County Fire Department', publicationDate: '2026-01-10',
    incidentDate: '2026-01-09', locations: ['United States'],
    text: `A consumer suffered burns and was hospitalized after the ${entity.productName} caught fire.`
  };
  const provider = {
    async search() { searches += 1; return [candidate, { ...candidate }]; },
    async fetch(value) { return value; }
  };
  const run = await runRecallSearch(record, provider, { cache, now: '2026-08-31T00:00:00Z' });
  assert.equal(run.audit.urlsRetrieved, 1);
  assert.equal(run.audit.windowsSearched.length, 1);
  assert.equal(searches, run.audit.queries.length);
  assert.equal(run.audit.methodologyVersion, VERSIONS.methodologyVersion);
  assert.ok(run.audit.selectedCandidateId);
  assert.equal(run.selection.firstQualifiedArticle.qualification, 'qualified_pre_recall');
});

test('50+ recall benchmark meets classification quality and cached latency gates', () => {
  const report = evaluateBenchmark(data.records, fixture);
  assert.ok(report.fixtureSize >= 50);
  assert.ok(report.classificationAccuracy >= .95, `accuracy ${report.classificationAccuracy}`);
  assert.ok(report.knownHarmRecall >= .95, `recall ${report.knownHarmRecall}`);
  assert.ok(report.top5Precision >= .90, `precision ${report.top5Precision}`);
  assert.equal(report.recallAnnouncementFalsePositiveRate, 0);
  assert.ok(report.duplicateIncidentRate < .05);
  assert.ok(report.cachedEquivalentP95Ms < 4000);
});
