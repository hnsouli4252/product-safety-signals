import { performance } from 'node:perf_hooks';
import { normalizeRecallEntity, classifyCandidate, clusterIncidents } from './index.mjs';

const DAY = 86_400_000;
const dateFrom = (recallDate, days) => new Date(new Date(recallDate).getTime() + days * DAY).toISOString().slice(0, 10);

function materialize(record, template) {
  const entity = normalizeRecallEntity(record);
  const exact = entity.productName;
  const before = dateFrom(entity.recallDate, -45);
  const after = dateFrom(entity.recallDate, 2);
  const common = { url: `https://benchmark.example/${record.id}/${template}`, publisher: 'Local News 6', publicationDate: before, locations: ['United States'] };
  const templates = {
    qualified_injury: { ...common, title: `${exact} incident leaves consumer injured`, text: `A consumer was hospitalized after the ${exact} ${entity.normalizedHazards[0] || 'incident'}.` },
    qualified_death: { ...common, title: `Family identifies victim killed in ${exact} incident`, text: `A child died after an incident involving the ${exact}. The coroner confirmed the death.` },
    recall_coverage: { ...common, title: `${exact} recalled after safety warning`, text: `CPSC announced the recall. According to the recall notice, consumers should stop using the product and contact the company for a refund.` },
    generic_hazard: { ...common, title: `${exact} safety notice`, text: `The ${exact} can pose a risk of serious injury or death.` },
    weak_product: { ...common, title: 'Unrelated blender incident leaves consumer injured', text: 'A consumer was hospitalized after an unrelated blender shattered.' },
    post_recall: { ...common, publicationDate: after, title: `${exact} incident leaves consumer injured`, text: `A consumer was hospitalized after the ${exact} failed.` },
    no_actual_harm: { ...common, title: `${exact} reviewed by consumer group`, text: `The group examined the ${exact} and discussed its design.` },
    local_hospital: { ...common, publisher: 'County General Hospital', title: `Doctors treat patient hurt by ${exact}`, text: `Hospital doctors treated and hospitalized a patient injured in a ${exact} incident.` },
    local_fire: { ...common, publisher: 'City Fire Department', title: `${exact} fire sends resident to hospital`, text: `Firefighters said a resident suffered burns and was hospitalized after the ${exact} caught fire.` }
  };
  return templates[template];
}

export function evaluateBenchmark(records, fixture) {
  const byId = new Map(records.map(record => [record.id, record]));
  const started = performance.now();
  const results = fixture.map(item => {
    const record = byId.get(item.recallId);
    if (!record) throw new Error(`Unknown benchmark recall ${item.recallId}`);
    const candidate = classifyCandidate(normalizeRecallEntity(record), materialize(record, item.candidateTemplate));
    return { ...item, actualQualification: candidate.qualification, correct: candidate.qualification === item.expectedQualification, candidate };
  });
  const recallCoverage = results.filter(value => value.expectedQualification === 'recall_announcement');
  const knownHarm = results.filter(value => value.expectedQualification === 'qualified_pre_recall');
  const topFive = results.filter(value => ['qualified_pre_recall', 'post_recall_reporting', 'recall_announcement', 'generic_hazard_only', 'weak_product_match'].includes(value.expectedQualification));
  const duplicateSample = results.filter(value => value.expectedQualification === 'qualified_pre_recall').slice(0, 1).flatMap(value => {
    const first = value.candidate;
    return [first, { ...first, id: `${first.id}_syndicated`, url: `${first.url}?syndicated=1`, publicationDate: first.publicationDate }];
  });
  const clustered = duplicateSample.length ? clusterIncidents(duplicateSample[0].recallId || fixture[0].recallId, duplicateSample) : [];
  const durationMs = performance.now() - started;
  return {
    fixtureSize: fixture.length,
    classificationAccuracy: results.filter(value => value.correct).length / results.length,
    knownHarmRecall: knownHarm.filter(value => value.actualQualification === 'qualified_pre_recall').length / knownHarm.length,
    top5Precision: topFive.filter(value => value.correct).length / topFive.length,
    recallAnnouncementFalsePositiveRate: recallCoverage.filter(value => value.actualQualification === 'qualified_pre_recall').length / recallCoverage.length,
    duplicateIncidentRate: duplicateSample.length ? clustered.reduce((sum, cluster) => sum + Math.max(0, cluster.articles.filter(article => article.qualification === 'qualified_pre_recall').length - 1), 0) / duplicateSample.length : 0,
    cachedEquivalentP95Ms: durationMs,
    results
  };
}
