import { Router } from 'express';
import { backupStatus } from '../lib/backup.js';
import { wrap } from '../lib/http.js';

const router = Router();

/**
 * Whether backups are happening: on or off, when the newest is from, how many, and a problem if there is one. Read-only on purpose:
 * where the files are and how to start or delete one stay out of reach of the web, since a backup holds everyone's data.
 */
router.get(
  '/backups/status',
  wrap(async (_req, res) => {
    res.json(backupStatus());
  }),
);

export default router;
