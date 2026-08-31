import taxonomy from '../../config/harm-taxonomy.json' with { type: 'json' };

export const VERSIONS = Object.freeze({
  methodologyVersion: '2.0.0',
  classifierVersion: '2.0.0',
  queryGeneratorVersion: '2.0.0'
});

export const QUALIFICATIONS = Object.freeze([
  'qualified_pre_recall', 'post_recall_reporting', 'recall_announcement',
  'generic_hazard_only', 'weak_product_match', 'no_actual_harm',
  'duplicate_incident', 'needs_review'
]);

const DAY = 86_400_000;
const sourceBoosts = [
  /\b(AP|Associated Press|Reuters)\b/i, /\b(CBS|NBC|ABC|FOX|W[A-Z]{2,4}|K[A-Z]{2,4})\b/i,
  /\b(police|sheriff|coroner|medical examiner|fire department|hospital|court)\b/i
];

const clean = value => String(value ?? '').replace(/[®™]/g, '').replace(/\s+/g, ' ').trim();
const lower = value => clean(value).toLowerCase();
const tokens = value => lower(value).split(/[^a-z0-9]+/).filter(token => token.length > 2);
const uniq = values => [...new Set(values.filter(Boolean))];
const clamp = value => Math.max(0, Math.min(100, Math.round(value)));
const iso = value => new Date(value).toISOString().slice(0, 10);
const quote = value => `"${clean(value)}"`;
const hash = value => {
  let n = 2166136261;
  for (const char of String(value)) n = Math.imul(n ^ char.charCodeAt(0), 16777619);
  return (n >>> 0).toString(36);
};

export function normalizeRecallEntity(record) {
  const productName = clean(record.product || record.heading);
  const heading = clean(record.heading || productName);
  const words = productName.split(' ');
  const brand = clean(record.brand || words[0]);
  const modelMatches = uniq([...(record.models || []), ...productName.matchAll(/\b[A-Z0-9][A-Z0-9-]{2,}\b/g)].map(value => Array.isArray(value) ? value[0] : value));
  const productClass = clean(record.productClass || productName
    .replace(new RegExp(`^${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+`, 'i'), '')
    .replace(/\b(model|series)\s+[A-Z0-9-]+\b/gi, '')
    .replace(/\b(with|and)\b.*$/i, ''));
  const normalizedHazards = uniq(Object.keys(taxonomy.hazardExpansions).filter(key => lower(record.hazard).includes(key)));
  const aliases = uniq([
    ...(record.aliases || []),
    heading !== productName ? heading : '',
    `${brand} ${productClass}`,
    productClass,
    productClass.replace(/electric bicycle/gi, 'e-bike').replace(/recreational off highway vehicle/gi, 'ROV')
  ]).filter(value => lower(value) !== lower(productName));
  return {
    recallId: record.id,
    recallDate: iso(record.date),
    brand,
    manufacturer: clean(record.manufacturer),
    retailer: clean(record.retailer),
    productName,
    productClass,
    models: modelMatches,
    skus: uniq(record.skus || []),
    aliases,
    hazardText: clean(record.hazard),
    normalizedHazards,
    incidentNarrative: clean(record.incidents),
    knownIncidentLocations: record.knownIncidentLocations || [],
    victimAges: record.victimAges || []
  };
}

export function expandHarmTerms(entity) {
  const hazardTerms = entity.normalizedHazards.flatMap(key => taxonomy.hazardExpansions[key] || []);
  return uniq([
    ...taxonomy.fatalityTerms,
    ...taxonomy.generalInjuryTerms,
    ...taxonomy.injuryTypes,
    ...taxonomy.eventTerms,
    ...hazardTerms
  ]);
}

export function generateQueries(entity, { limit = 12 } = {}) {
  const exact = entity.models[0] ? `${entity.brand} ${entity.models[0]}` : entity.productName;
  const product = entity.productClass || entity.productName;
  const mechanism = entity.normalizedHazards[0] || tokens(entity.hazardText)[0] || 'injury';
  const location = entity.knownIncidentLocations[0];
  const locationText = location ? [location.city, location.state, location.country].filter(Boolean).join(' ') : '';
  const candidates = [
    `${quote(exact)} injury`, `${quote(exact)} death`, `${quote(exact)} killed`, `${quote(exact)} hospitalized`,
    `${quote(entity.brand)} ${quote(product)} ${mechanism} injury`, `${quote(entity.brand)} ${quote(product)} fatal ${mechanism}`,
    `${quote(entity.manufacturer || entity.brand)} ${quote(product)} lawsuit injury`,
    `${quote(entity.brand)} ${quote(product)} coroner`, `${quote(entity.brand)} ${quote(product)} fire department`,
    `${quote(product)} child killed`, `${quote(product)} consumer hospitalized`, `${quote(product)} sheriff injury`,
    locationText && `${quote(product)} ${quote(locationText)} death`,
    entity.victimAges[0] != null && `${quote(entity.brand)} ${quote(product)} ${entity.victimAges[0]} year old injured`,
    ...entity.aliases.slice(0, 2).map(alias => `${quote(alias)} injury`)
  ];
  return uniq(candidates).slice(0, Math.max(8, Math.min(15, limit)));
}

export function progressiveWindows(recallDate, { exhaustive = false } = {}) {
  const end = new Date(recallDate);
  const offsets = [[0, 30], [31, 90], [91, 365], [366, 1095], [1096, 3650]];
  const windows = offsets.map(([near, far]) => ({
    start: iso(new Date(end.getTime() - far * DAY)),
    end: iso(new Date(end.getTime() - near * DAY))
  }));
  return exhaustive ? windows : windows;
}

export function classifyActualHarm(candidate) {
  const text = `${candidate.title || ''} ${candidate.text || ''}`;
  const normalized = lower(text);
  const genericOnly = /\b(risk|hazard|can|could|may|poses?)\b.{0,45}\b(injury|death|burn|choking|electrocution)\b/i.test(text)
    && !/\b(died|dead|killed|injured|hurt|hospitalized|hospitalised|treated|suffered|sustained|burned|burnt|fractured|amputat|poisoned|electrocuted)\b/i.test(text);
  const deathMatches = normalized.match(/\b(died|dead|killed|deceased|fatality|fatalities)\b/g) || [];
  const injuryMatches = normalized.match(/\b(injured|hurt|hospitalized|hospitalised|treated|suffered|sustained|burned|burnt|fractured|amputat\w*|poisoned|electrocuted)\b/g) || [];
  const injuryTypes = taxonomy.injuryTypes.filter(term => normalized.includes(term));
  const actualHarm = !genericOnly && (deathMatches.length > 0 || injuryMatches.length > 0);
  return {
    actualHarm,
    injuryCount: candidate.injuryCount ?? (injuryMatches.length ? 1 : 0),
    deathCount: candidate.deathCount ?? (deathMatches.length ? 1 : 0),
    injuryTypes,
    confidence: actualHarm ? clamp(70 + Math.min(25, (deathMatches.length + injuryMatches.length) * 8)) : genericOnly ? 95 : 60,
    genericOnly
  };
}

export function detectRecallCoverage(candidate, recallDate) {
  const text = `${candidate.title || ''} ${candidate.text || ''}`;
  const signalHits = taxonomy.recallCoverageSignals.filter(signal => lower(text).includes(lower(signal)));
  const recallDensity = (lower(text).match(/\brecall(?:ed|s|ing)?\b/g) || []).length;
  const postRecall = candidate.publicationDate && new Date(candidate.publicationDate) >= new Date(recallDate);
  return {
    recallCoverage: signalHits.length > 0 || recallDensity >= 3,
    signals: signalHits,
    postRecall
  };
}

function overlapScore(target, candidate) {
  const targetTokens = new Set(tokens(target));
  const candidateTokens = new Set(tokens(candidate));
  if (!targetTokens.size) return 0;
  return 100 * [...targetTokens].filter(token => candidateTokens.has(token)).length / targetTokens.size;
}

export function scoreCandidate(entity, candidate) {
  const body = `${candidate.title || ''} ${candidate.text || ''}`;
  const exactModel = entity.models.some(model => lower(body).includes(lower(model)));
  const exactProduct = lower(body).includes(lower(entity.productName));
  const productMatchScore = clamp(Math.max(overlapScore(entity.productName, body), exactProduct ? 92 : 0, exactModel ? 100 : 0));
  const harm = classifyActualHarm(candidate);
  const hazardTerms = uniq([...entity.normalizedHazards, ...entity.normalizedHazards.flatMap(key => taxonomy.hazardExpansions[key] || [])]);
  const hazardMatchScore = clamp(Math.max(0, ...hazardTerms.map(term => lower(body).includes(lower(term)) ? 90 : overlapScore(term, body))));
  const coverage = detectRecallCoverage(candidate, entity.recallDate);
  const daysBefore = candidate.publicationDate ? Math.floor((new Date(entity.recallDate) - new Date(candidate.publicationDate)) / DAY) : null;
  const timingScore = daysBefore == null ? 30 : daysBefore > 0 ? clamp(100 - Math.min(70, daysBefore / 52)) : 0;
  const sourceScore = clamp(45 + sourceBoosts.reduce((sum, pattern) => sum + (pattern.test(`${candidate.publisher || ''} ${body}`) ? 18 : 0), 0));
  const locations = entity.knownIncidentLocations.flatMap(value => Object.values(value));
  const geographyScore = locations.length ? clamp(Math.max(...locations.map(value => lower(body).includes(lower(value)) ? 100 : 20))) : 60;
  let confidence = productMatchScore * .30 + (harm.actualHarm ? harm.confidence : 0) * .25 + hazardMatchScore * .15 + timingScore * .15 + sourceScore * .10 + geographyScore * .05;
  if (coverage.recallCoverage) confidence -= 45;
  if (coverage.postRecall) confidence -= 20;
  if (harm.genericOnly) confidence -= 30;
  if (productMatchScore < 45) confidence -= 25;
  return { productMatchScore, harmMatchScore: harm.actualHarm ? harm.confidence : 0, hazardMatchScore, timingScore, sourceScore, geographyScore, confidence: clamp(confidence), daysBefore, harm, coverage };
}

export function classifyCandidate(entity, candidate, { productThreshold = 60 } = {}) {
  const scores = scoreCandidate(entity, candidate);
  let qualification = 'needs_review';
  let qualificationReason = 'Candidate requires human source review.';
  if (scores.coverage.recallCoverage) {
    qualification = 'recall_announcement'; qualificationReason = 'Recall-announcement language dominates the article.';
  } else if (!scores.harm.actualHarm && scores.harm.genericOnly) {
    qualification = 'generic_hazard_only'; qualificationReason = 'The article states a possible hazard but does not describe an actual injury or death.';
  } else if (!scores.harm.actualHarm) {
    qualification = 'no_actual_harm'; qualificationReason = 'No actual injury or death statement was detected.';
  } else if (scores.productMatchScore < productThreshold) {
    qualification = 'weak_product_match'; qualificationReason = 'Actual harm was found, but product identity is below the qualification threshold.';
  } else if (scores.coverage.postRecall) {
    qualification = 'post_recall_reporting'; qualificationReason = 'Actual harm reporting was published on or after the recall date.';
  } else if (candidate.publicationDate) {
    qualification = 'qualified_pre_recall'; qualificationReason = `Independent actual-harm reporting with a ${scores.productMatchScore}% product match, published ${scores.daysBefore} days before recall.`;
  }
  return {
    ...candidate,
    id: candidate.id || `candidate_${hash(candidate.canonicalUrl || candidate.url)}`,
    ...scores,
    actualHarm: scores.harm.actualHarm,
    deathCount: scores.harm.deathCount,
    injuryCount: scores.harm.injuryCount,
    injuryTypes: scores.harm.injuryTypes,
    recallCoverage: scores.coverage.recallCoverage,
    qualification,
    qualificationReason
  };
}

const incidentKey = candidate => {
  const date = candidate.incidentDate || candidate.publicationDate || 'unknown';
  const location = (candidate.locations || [])[0] || 'unknown';
  const event = candidate.injuryTypes?.[0] || tokens(candidate.title)[0] || 'incident';
  return `${date.slice(0, 10)}|${lower(location)}|${lower(event)}`;
};

export function clusterIncidents(recallId, candidates) {
  const groups = new Map();
  for (const candidate of candidates) {
    const key = incidentKey(candidate);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(candidate);
  }
  return [...groups.entries()].map(([key, articles]) => {
    const sorted = [...articles].sort((a, b) => new Date(a.publicationDate || 8640000000000000) - new Date(b.publicationDate || 8640000000000000));
    sorted.slice(1).forEach(article => {
      if (article.qualification === 'qualified_pre_recall') article.qualification = 'duplicate_incident';
    });
    return {
      incidentId: `incident_${hash(`${recallId}|${key}`)}`,
      recallId,
      estimatedIncidentDate: sorted[0].incidentDate,
      location: sorted[0].locations?.[0],
      deaths: Math.max(0, ...sorted.map(value => value.deathCount || 0)),
      injuries: Math.max(0, ...sorted.map(value => value.injuryCount || 0)),
      articles: sorted,
      earliestArticle: sorted.find(value => value.qualification === 'qualified_pre_recall') || sorted[0]
    };
  });
}

export function selectEarliestQualified(clusters, recallDate) {
  const candidates = clusters.flatMap(cluster => cluster.articles)
    .filter(candidate => candidate.qualification === 'qualified_pre_recall')
    .sort((a, b) => new Date(a.publicationDate) - new Date(b.publicationDate));
  const firstQualifiedArticle = candidates[0] || null;
  return {
    firstQualifiedArticle,
    firstKnownIncident: clusters.map(value => value.estimatedIncidentDate).filter(Boolean).sort()[0] || null,
    daysBeforeRecall: firstQualifiedArticle ? Math.floor((new Date(recallDate) - new Date(firstQualifiedArticle.publicationDate)) / DAY) : null
  };
}

export class SearchCache {
  constructor() { this.queryResults = new Map(); this.articleContent = new Map(); this.classifications = new Map(); }
  queryKey(recallId, query, window) { return `${recallId}:${hash(`${query}|${window.start}|${window.end}`)}`; }
  classificationKey(candidate) { return `${candidate.url}:${candidate.contentHash || hash(candidate.text || '')}:${VERSIONS.classifierVersion}:${VERSIONS.methodologyVersion}`; }
}

export function applyReviewerOverride(candidate, review) {
  if (!review) return candidate;
  return { ...candidate, review: { ...review }, modelQualification: candidate.qualification };
}

export async function runRecallSearch(record, provider, { exhaustive = false, cache = new SearchCache(), existingReviews = {}, now = new Date().toISOString(), onProgress = () => {} } = {}) {
  const entity = normalizeRecallEntity(record);
  const queries = generateQueries(entity);
  const windows = progressiveWindows(entity.recallDate, { exhaustive });
  const startedAt = now;
  const urls = new Map();
  const searched = [];
  for (const window of windows) {
    searched.push(window);
    for (const query of queries) {
      const key = cache.queryKey(entity.recallId, query, window);
      let results = cache.queryResults.get(key);
      if (!results) {
        results = await provider.search({ entity, query, window });
        cache.queryResults.set(key, results);
      }
      for (const result of results || []) urls.set(result.canonicalUrl || result.url, result);
    }
    const cheap = [...urls.values()].map(candidate => classifyCandidate(entity, candidate)).sort((a, b) => b.confidence - a.confidence);
    onProgress({ phase: 'candidate_metadata', recallId: entity.recallId, window, urlsRetrieved: urls.size, topCandidates: cheap.slice(0, 5) });
    if (!exhaustive && cheap.some(candidate => candidate.qualification === 'qualified_pre_recall' && candidate.confidence >= 80)) break;
  }
  const metadataRanked = [...urls.values()].map(candidate => classifyCandidate(entity, candidate)).sort((a, b) => b.confidence - a.confidence);
  const fetched = [];
  for (const candidate of metadataRanked.slice(0, 25)) {
    const articleKey = candidate.canonicalUrl || candidate.url;
    let full = cache.articleContent.get(articleKey);
    if (!full) {
      full = provider.fetch ? await provider.fetch(candidate) : candidate;
      cache.articleContent.set(articleKey, full);
    }
    const key = cache.classificationKey(full);
    let classified = cache.classifications.get(key);
    if (!classified) {
      classified = classifyCandidate(entity, full);
      cache.classifications.set(key, classified);
    }
    fetched.push(applyReviewerOverride(classified, existingReviews[classified.id]));
    if (fetched.length === 5 || fetched.length === 10 || fetched.length === metadataRanked.slice(0, 25).length) {
      onProgress({ phase: 'candidate_pages', recallId: entity.recallId, candidatesEvaluated: fetched.length, candidates: fetched.slice(0, 5) });
    }
  }
  const clusters = clusterIncidents(entity.recallId, fetched);
  const selection = selectEarliestQualified(clusters, entity.recallDate);
  return {
    entity,
    candidates: fetched,
    clusters,
    selection,
    audit: {
      recallId: entity.recallId,
      startedAt,
      completedAt: new Date().toISOString(),
      ...VERSIONS,
      queries,
      windowsSearched: searched,
      urlsRetrieved: urls.size,
      candidatesEvaluated: fetched.length,
      incidentClustersCreated: clusters.length,
      qualifiedCandidateCount: fetched.filter(value => value.qualification === 'qualified_pre_recall').length,
      selectedCandidateId: selection.firstQualifiedArticle?.id
    }
  };
}

export { taxonomy };
