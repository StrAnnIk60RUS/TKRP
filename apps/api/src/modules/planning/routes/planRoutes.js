import { generateDraftPlanBatched } from '../services/draftPlanGenerationPipeline.js';
import { runHierarchicalOptimization } from '../services/evolutionary/hierarchicalGa.js';
import { searchPrecedents } from '../../precedents/repositories/precedentRepository.js';
import { loadDraft, saveDraft } from '../services/draftStore.js';
import { deleteSnapshot, listSnapshots, loadSnapshot, saveSnapshot } from '../services/planSnapshotStore.js';
import { createPlanRouter } from './planRouterCore.js';

const defaultDeps = {
  generateDraftPlanBatched,
  searchPrecedents,
  runHierarchicalOptimization,
  loadDraft,
  saveDraft,
  saveSnapshot,
  listSnapshots,
  loadSnapshot,
  deleteSnapshot
};

const router = createPlanRouter(defaultDeps);

export default router;
export { createPlanRouter, defaultDeps };
