import { Router } from 'express';
import { requireAuth } from '../middleware/auth';
import { isAdolarConfigured } from '../services/adolarClient';
import { listCatalogedPlaylists, listPlaylistsForBrowsing } from '../services/adolarPlaylistCatalog';

export const adolarRouter = Router();

// Lets the "Tisch erstellen" form offer a playlist dropdown instead of
// asking for a raw Adolar playlist id. Any authenticated user (table
// creation itself isn't admin-only) - not just admins. Reads the local
// catalog (kept current by syncAllAdolarPlaylists) instead of calling
// Adolar live on every page load - a playlist added/removed on the Adolar
// side only shows up here after the next sync.
adolarRouter.get('/adolar/playlists', requireAuth, async (_req, res) => {
  const configured = await isAdolarConfigured();
  if (!configured) {
    res.status(200).json({ configured: false, playlists: [] });
    return;
  }
  const playlists = await listCatalogedPlaylists();
  res.status(200).json({ configured: true, playlists });
});

// Feeds the "Songster PlayLists" lobby dialog - every currently cataloged
// playlist with its effective display name and admin-set description, for
// browsing only (no table/session tie-in). Any authenticated user.
adolarRouter.get('/playlists', requireAuth, async (_req, res) => {
  const playlists = await listPlaylistsForBrowsing();
  res.status(200).json({ playlists });
});
