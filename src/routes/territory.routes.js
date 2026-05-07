const express    = require('express');
const authenticate = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

// ── GET /api/map/territories?minLat&maxLat&minLng&maxLng ────────────────────
router.get('/territories', async (req, res, next) => {
  try {
    const { minLat, maxLat, minLng, maxLng } = req.query;

    let q = supabaseAdmin.from('territories').select('*');
    if (minLat && maxLat && minLng && maxLng) {
      q = q
        .gte('center_lat', parseFloat(minLat)).lte('center_lat', parseFloat(maxLat))
        .gte('center_lng', parseFloat(minLng)).lte('center_lng', parseFloat(maxLng));
    }

    const { data, error } = await q;
    if (error) throw error;

    const territories = data.map((t) => ({
      id:          t.id,
      name:        t.name,
      ownerColor:  t.owner_color,
      coordinates: t.coordinates,
      owner_id:    t.owner_id,
      isOwn:       false, // client sets this by comparing with logged-in userId
    }));
    res.json({ territories });
  } catch (err) { next(err); }
});

// ── POST /api/map/territories/capture ───────────────────────────────────────
router.post('/territories/capture', authenticate, async (req, res, next) => {
  try {
    const { zone_id } = req.body;
    if (!zone_id) return res.status(400).json({ message: 'zone_id required' });

    const { data, error } = await supabaseAdmin.from('territories')
      .update({ owner_id: req.userId, owner_color: '#E94560', captured_at: new Date().toISOString() })
      .eq('id', zone_id).select().single();
    if (error) throw error;

    // Recalculate user's territory %
    const [{ count: owned }, { count: total }] = await Promise.all([
      supabaseAdmin.from('territories').select('*', { count: 'exact', head: true }).eq('owner_id', req.userId),
      supabaseAdmin.from('territories').select('*', { count: 'exact', head: true }),
    ]);
    const pct = total > 0 ? parseFloat(((owned / total) * 100).toFixed(1)) : 0;
    await supabaseAdmin.from('profiles').update({ territory_percent: pct }).eq('id', req.userId);

    res.json({ territory: data });
  } catch (err) { next(err); }
});

// ── GET /api/map/territories/user/:userId ───────────────────────────────────
router.get('/territories/user/:userId', authenticate, async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from('territories')
      .select('*').eq('owner_id', req.params.userId);
    if (error) throw error;
    res.json({ territories: data });
  } catch (err) { next(err); }
});

// ── GET /api/map/territories/stats/:userId ──────────────────────────────────
router.get('/territories/stats/:userId', authenticate, async (req, res, next) => {
  try {
    const [{ count: owned }, { count: total }] = await Promise.all([
      supabaseAdmin.from('territories').select('*', { count: 'exact', head: true }).eq('owner_id', req.params.userId),
      supabaseAdmin.from('territories').select('*', { count: 'exact', head: true }),
    ]);
    const percent = total > 0 ? parseFloat(((owned / total) * 100).toFixed(1)) : 0;
    res.json({ stats: { owned, total, percent } });
  } catch (err) { next(err); }
});

module.exports = router;
