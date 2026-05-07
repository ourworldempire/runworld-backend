const express    = require('express');
const authenticate = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

function toEntry(p, i, myId) {
  return {
    id:               p.id,
    rank:             i + 1,
    name:             p.name,
    avatar:           p.avatar,
    level:            p.level,
    xp:               p.xp ?? 0,
    distanceKm:       parseFloat((p.total_distance_km || p.distanceKm || 0).toFixed(1)),
    territoryPercent: p.territory_percent || 0,
    isYou:            p.id === myId,
  };
}

// ── GET /api/leaderboard/city?period=week|all&limit=50 ──────────────────────
router.get('/city', authenticate, async (req, res, next) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit) || 50, 100);
    const period = req.query.period || 'week';
    let entries;

    if (period === 'week') {
      const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
      const { data: sessions, error } = await supabaseAdmin
        .from('run_sessions').select('user_id, xp_earned, distance_km').gte('created_at', weekAgo);
      if (error) throw error;

      const agg = {};
      sessions.forEach((s) => {
        if (!agg[s.user_id]) agg[s.user_id] = { xp: 0, distanceKm: 0 };
        agg[s.user_id].xp          += s.xp_earned  || 0;
        agg[s.user_id].distanceKm  += s.distance_km || 0;
      });

      const uids = Object.keys(agg);
      if (!uids.length) return res.json({ entries: [] });

      const { data: profiles, error: pe } = await supabaseAdmin
        .from('profiles').select('id, name, avatar, level, territory_percent').in('id', uids);
      if (pe) throw pe;

      entries = profiles
        .map((p) => ({ ...p, xp: agg[p.id]?.xp || 0, total_distance_km: agg[p.id]?.distanceKm || 0 }))
        .sort((a, b) => b.xp - a.xp).slice(0, limit)
        .map((p, i) => toEntry(p, i, req.userId));
    } else {
      const { data: profiles, error } = await supabaseAdmin
        .from('profiles').select('id, name, avatar, level, xp, total_distance_km, territory_percent')
        .order('xp', { ascending: false }).limit(limit);
      if (error) throw error;
      entries = profiles.map((p, i) => toEntry(p, i, req.userId));
    }

    res.json({ entries });
  } catch (err) { next(err); }
});

// ── GET /api/leaderboard/friends?period=week|all ────────────────────────────
router.get('/friends', authenticate, async (req, res, next) => {
  try {
    const { data: friendships } = await supabaseAdmin.from('friendships')
      .select('requester_id, addressee_id').eq('status', 'accepted')
      .or(`requester_id.eq.${req.userId},addressee_id.eq.${req.userId}`);

    const ids = [(friendships || []).map((f) =>
      f.requester_id === req.userId ? f.addressee_id : f.requester_id
    ), req.userId].flat();

    const { data: profiles, error } = await supabaseAdmin
      .from('profiles').select('id, name, avatar, level, xp, total_distance_km, territory_percent')
      .in('id', ids).order('xp', { ascending: false });
    if (error) throw error;

    res.json({ entries: profiles.map((p, i) => toEntry(p, i, req.userId)) });
  } catch (err) { next(err); }
});

// ── GET /api/leaderboard/nearby — city top 20 (no PostGIS) ──────────────────
router.get('/nearby', authenticate, async (req, res, next) => {
  try {
    const { data: profiles, error } = await supabaseAdmin
      .from('profiles').select('id, name, avatar, level, xp, total_distance_km, territory_percent')
      .order('xp', { ascending: false }).limit(20);
    if (error) throw error;
    res.json({ entries: profiles.map((p, i) => toEntry(p, i, req.userId)) });
  } catch (err) { next(err); }
});

module.exports = router;
