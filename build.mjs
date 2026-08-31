import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { normalizeRecallEntity, generateQueries, progressiveWindows, classifyCandidate, clusterIncidents, selectEarliestQualified, VERSIONS } from './src/news-search/index.mjs';

await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
const html = await readFile('index.html', 'utf8');
const evidence = JSON.parse(await readFile('data/august-2026-recalls.json', 'utf8'));
const taxonomy = JSON.parse(await readFile('config/harm-taxonomy.json', 'utf8'));
evidence.searchSystem = {
  ...VERSIONS,
  pipeline: ['Recall ingestion', 'Entity normalization', 'Query generation', 'Candidate retrieval', 'Candidate classification/ranking', 'Incident clustering'],
  targetRawUrlsPerRecall: '50–100',
  liveProviders: ['Google News RSS', 'Bing News RSS', 'GDELT DOC 2.0'],
  liveEndpoint: '/api/news-search',
  liveCacheSeconds: 900,
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
let runtime = await readFile('src/news-search/index.mjs', 'utf8');
runtime = runtime.replace(/import taxonomy from .*?;\n/, `const taxonomy=${JSON.stringify(taxonomy)};\n`);
await writeFile('dist/server/news-search.mjs', runtime);
await copyFile('src/news-search/providers.mjs', 'dist/server/providers.mjs');
const worker = `import {classifyCandidate,clusterIncidents,selectEarliestQualified} from './news-search.mjs';
import {CompositeNewsProvider} from './providers.mjs';
const html=${JSON.stringify(html)};
const evidence=${JSON.stringify(evidence)};
const timedFetch=(input,init={})=>fetch(input,{...init,signal:AbortSignal.timeout(5000)});
const liveProvider=new CompositeNewsProvider({fetchImpl:timedFetch});
const json=(value,status=200,cache='no-store')=>Response.json(value,{status,headers:{'cache-control':cache,'access-control-allow-origin':'*','x-content-type-options':'nosniff'}});
async function liveSearch(request,url){
  const recallId=url.searchParams.get('recallId');
  const run=evidence.searchRuns.find(value=>value.recallId===recallId);
  if(!run)return json({error:'Unknown recall ID'},404);
  const windowIndex=Math.max(0,Math.min(run.windowsSearched.length-1,Number(url.searchParams.get('window')||0)));
  const offset=Math.max(0,Math.min(run.queries.length-1,Number(url.searchParams.get('offset')||0)));
  const limit=Math.max(1,Math.min(5,Number(url.searchParams.get('limit')||3)));
  const queries=run.queries.slice(offset,offset+limit);
  const window=run.windowsSearched[windowIndex];
  const cache=globalThis.caches?.default;
  const cacheKey=new Request(url.toString(),{method:'GET',headers:{accept:'application/json'}});
  const cached=cache?await cache.match(cacheKey):null;
  if(cached)return cached;
  const results=await Promise.all(queries.map(query=>liveProvider.search({entity:run.entity,query,window})));
  const providerMap=new Map();
  for(const status of results.flatMap(result=>result.providerStatus)){
    const current=providerMap.get(status.id)||{id:status.id,label:status.label,ok:false,count:0,error:null};
    current.ok=current.ok||status.ok;current.count+=status.count||0;if(!status.ok)current.error=status.error;providerMap.set(status.id,current);
  }
  const providerStatus=[...providerMap.values()];
  const unique=new Map();
  for(const candidate of results.flatMap(result=>result.candidates))unique.set(candidate.canonicalUrl||candidate.url,candidate);
  const metadata=[...unique.values()].map(candidate=>classifyCandidate(run.entity,candidate)).sort((a,b)=>b.confidence-a.confidence);
  const detailed=await Promise.all(metadata.slice(0,8).map(async candidate=>{
    try{return classifyCandidate(run.entity,await liveProvider.fetchArticle(candidate))}catch{return candidate}
  }));
  const candidates=[...detailed,...metadata.slice(8)].sort((a,b)=>b.confidence-a.confidence).slice(0,40);
  const clusters=clusterIncidents(recallId,candidates);
  const selection=selectEarliestQualified(clusters,run.entity.recallDate);
  const payload={live:true,reviewStatus:'unreviewed',humanReviewRequired:true,recallId,queries,window,offset,nextOffset:offset+limit<run.queries.length?offset+limit:null,nextWindow:windowIndex+1<run.windowsSearched.length?windowIndex+1:null,providerStatus,urlsRetrieved:unique.size,candidatesEvaluated:candidates.length,incidentClustersCreated:clusters.length,qualifiedCandidateCount:candidates.filter(value=>value.qualification==='qualified_pre_recall').length,selectedCandidate:selection.firstQualifiedArticle,candidates,methodologyVersion:run.methodologyVersion,classifierVersion:run.classifierVersion,retrievedAt:new Date().toISOString()};
  const response=json(payload,200,'public, max-age=900');
  if(cache)await cache.put(cacheKey,response.clone());
  return response;
}
export default {async fetch(request){const url=new URL(request.url);if(url.pathname==='/health')return new Response('ok',{headers:{'content-type':'text/plain'}});if(url.pathname==='/api/evidence')return json(evidence,200,'public, max-age=300');if(url.pathname==='/api/news-search'){try{return await liveSearch(request,url)}catch(error){return json({error:'Live news search temporarily unavailable',detail:error?.message||'Unknown provider error',humanReviewRequired:true},502)}}return new Response(html,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=300','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin'}})}};`;
await writeFile('dist/server/index.js', worker);
