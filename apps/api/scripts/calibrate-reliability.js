// Calibrate reliability weights from the actual precedents distribution.
// Reads the active storage backend snapshot, scores every record (retrieval
// factor = 0: calibration measures structural data quality only), then
// proposes RELIABILITY_WEIGHT_* env values hitting RELIABILITY_TARGET_MEAN.
import { getPrecedentsSnapshot } from '../src/modules/precedents/repositories/precedentRepository.js';
import {
  computePublicationReliability,
  computeContentPlanReliability,
  getReliabilityDistribution,
  calibrateWeights
} from '../src/modules/precedents/services/precedentReliabilityService.js';

const targetMean = Number(process.env.RELIABILITY_TARGET_MEAN) || 0.6;

const snapshot = await getPrecedentsSnapshot();
const publications = Array.isArray(snapshot?.publications) ? snapshot.publications : [];
const contentPlans = Array.isArray(snapshot?.content_plans) ? snapshot.content_plans : [];

for (const data of publications) {
  computePublicationReliability({ type: 'publication', score: 0, data });
}
for (const data of contentPlans) {
  computeContentPlanReliability({ type: 'content_plan', score: 0, data });
}

const distribution = getReliabilityDistribution();
const total = distribution.count_publications + distribution.count_content_plans;

if (total === 0) {
  console.log('No precedents found — nothing to calibrate.');
  process.exit(0);
}

const { weights, projected_mean } = calibrateWeights(distribution, targetMean);

console.log(`Samples: ${distribution.count_publications} publications, ${distribution.count_content_plans} content plans`);
const overallMean = (
  distribution.stats.publications.mean * distribution.count_publications +
  distribution.stats.content_plans.mean * distribution.count_content_plans
) / total;
console.log(`Current mean reliability: ${overallMean.toFixed(3)}`);
console.log('Recommended weights (projected mean = ' + projected_mean + '):');
console.log(`  RELIABILITY_WEIGHT_RETRIEVAL=${weights.retrieval}`);
console.log(`  RELIABILITY_WEIGHT_COMPLETENESS=${weights.completeness}`);
console.log(`  RELIABILITY_WEIGHT_SOURCE_TRUST=${weights.source_trust}`);
