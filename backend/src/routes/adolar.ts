import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { AdolarClientError, listPlaylists } from '../services/adolarClient';

export const adolarRouter = Router();

// Lets the "Tisch erstellen" form offer a playlist dropdown instead of
// asking for a raw Adolar playlist id. Any authenticated user (table
// creation itself isn't admin-only) - not just admins.
adolarRouter.get('/adolar/playlists', requireAuth, async (_req, res) => {
  try {
    const playlists = await listPlaylists();
    res.status(200).json({ configured: true, playlists });
  } catch (err) {
    if (err instanceof AdolarClientError && err.code === 'NOT_CONFIGURED') {
      res.status(200).json({ configured: false, playlists: [] });
      return;
    }
    if (err instanceof AdolarClientError) {
      res.status(502).json({ configured: true, playlists: [], error: err.message });
      return;
    }
    throw err;
  }
});
