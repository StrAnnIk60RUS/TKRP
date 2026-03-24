import { Router } from 'express';

import mlRoutes from '../modules/ml/routes/mlRoutes.js';
import enrichmentRoutes from '../modules/enrichment/routes/enrichmentRoutes.js';
import planRoutes from '../modules/planning/routes/planRoutes.js';
import precedentRoutes from '../modules/precedents/routes/precedentRoutes.js';

const router = Router();

router.use('/precedents', precedentRoutes);
router.use('/plan', planRoutes);
router.use('/ml', mlRoutes);
router.use(enrichmentRoutes);

export default router;





