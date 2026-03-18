import { Router } from 'express';

import mlRoutes from './mlRoutes.js';
import parserRoutes from './parserRoutes.js';
import planRoutes from './planRoutes.js';
import precedentRoutes from './precedentRoutes.js';

const router = Router();

router.use('/precedents', precedentRoutes);
router.use('/plan', planRoutes);
router.use('/ml', mlRoutes);
router.use(parserRoutes);

export default router;
