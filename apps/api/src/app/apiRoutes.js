import { Router } from 'express';

import mlRoutes from '../modules/ml/routes/mlRoutes.js';
import enrichmentRoutes from '../modules/enrichment/routes/enrichmentRoutes.js';
import planRoutes from '../modules/planning/routes/planRoutes.js';
import precedentRoutes from '../modules/precedents/routes/precedentRoutes.js';
import authRoutes from '../modules/auth/routes/authRoutes.js';
import telemetryRoutes from '../modules/telemetry/routes/telemetryRoutes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/precedents', precedentRoutes);
router.use('/plan', planRoutes);
router.use('/ml', mlRoutes);
router.use('/telemetry', telemetryRoutes);
router.use(enrichmentRoutes);

// Compatibility fallback for legacy single-user lock requests: system is multi-user
router.all(['/session', '/session/*'], (_req, res) => {
  res.json({
    locked: false,
    isOwner: true,
    role: 'owner',
    multiUser: true
  });
});

export default router;





