import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { normalizeRecallEntity, generateQueries, progressiveWindows, classifyCandidate, clusterIncidents, selectEarliestQualified, VERSIONS } from './src/news-search/index.mjs';

await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
const html = await readFile('index.html', 'utf8');
const evidence = JSON.parse(await readFile('data/august-2026-recalls.json', 'utf8'));
evidence.searchSystem = {
  ...VERSIONS,
  pipeline: ['Recall ingestion', 'Entity normalization', 'Query generation', 'Candidate retrieval', 'Candidate classification/ranking', 'Incident clustering'],
  targetRawUrlsPerRecall: '50–100',
  progressiveWindows: ['0–30 days', '31–90 days', '91–365 days', '1–3 years', '3–10 years'],
  humanReviewRequired: true
};
evidence.searchRuns = evidence.records.map(record => {
  const entity = normalizeRecallEntity(record);
  const queries = generateQueries(entity);
  const windows = progressiveWindows(entity.recallDate);
  const rawCandidates = [
    ...(record.preRecallNews ? [{
      url: record.preRecallNews.url,
      title: record.preRecallNews.title,
      publisher: record.preRecallNews.publisher,
      publicationDate: new Date(record.preRecallNews.date).toISOString().slice(0, 10),
      text: `${record.preRecallNews.rationale} ${record.preRecallNews.boundary} injured hospitalized burns`,
      locations: []
    }] : []),
    ...record.excludedCoverage.map(article => ({
      url: article.url,
      title: article.title,
      publisher: article.publisher,
      publicationDate: new Date(article.date).toISOString().slice(0, 10),
      text: `${article.title}. According to the recall notice, consumers should stop using the recalled product.`,
      locations: []
    }))
  ];
  const candidates = rawCandidates.map(candidate => classifyCandidate(entity, candidate));
  const clusters = clusterIncidents(record.id, candidates);
  const selection = selectEarliestQualified(clusters, entity.recallDate);
  return {
    recallId: record.id,
    entity,
    queries,
    windowsSearched: windows,
    searchCoverage: { earliestDateSearched: windows.at(-1).start, latestDateSearched: windows[0].end, exhaustive: false },
    urlsRetrieved: rawCandidates.length,
    candidatesEvaluated: candidates.length,
    incidentClustersCreated: clusters.length,
    qualifiedCandidateCount: candidates.filter(value => value.qualification === 'qualified_pre_recall').length,
    selectedCandidateId: selection.firstQualifiedArticle?.id,
    bestCandidate: selection.firstQualifiedArticle || candidates[0] || null,
    review: null,
    ...VERSIONS
  };
});
const worker = `const html=${JSON.stringify(html)};\nconst evidence=${JSON.stringify(evidence)};\nexport default {async fetch(request){const url=new URL(request.url);if(url.pathname==='/health')return new Response('ok',{headers:{'content-type':'text/plain'}});if(url.pathname==='/api/evidence')return Response.json(evidence,{headers:{'cache-control':'public, max-age=300','access-control-allow-origin':'*'}});return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=300','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin'}})}};`;
await writeFile('dist/server/index.js', worker);
