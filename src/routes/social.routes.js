const express    = require('express');
const authenticate = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

// helper — get friend IDs for a user
async function friendIds(userId) {
  const { data } = await supabaseAdmin.from('friendships')
    .select('requester_id, addressee_id').eq('status', 'accepted')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);
  return (data || []).map((f) => f.requester_id === userId ? f.addressee_id : f.requester_id);
}

// ── GET /api/social/friends ──────────────────────────────────────────────────
router.get('/friends', authenticate, async (req, res, next) => {
  try {
    const ids = await friendIds(req.userId);
    if (!ids.length) return res.json({ friends: [] });

    const { data, error } = await supabaseAdmin
      .from('profiles').select('id, name, avatar, level, streak, territory_percent').in('id', ids);
    if (error) throw error;
    res.json({ friends: data });
  } catch (err) { next(err); }
});

// ── GET /api/social/friends/requests ────────────────────────────────────────
router.get('/friends/requests', authenticate, async (req, res, next) => {
  try {
    const { data: requests, error } = await supabaseAdmin
      .from('friendships').select('id, requester_id')
      .eq('addressee_id', req.userId).eq('status', 'pending');
    if (error) throw error;
    if (!requests.length) return res.json({ requests: [] });

    const uids = requests.map((r) => r.requester_id);
    const { data: profiles } = await supabaseAdmin
      .from('profiles').select('id, name, avatar, level').in('id', uids);

    const pMap = Object.fromEntries((profiles || []).map((p) => [p.id, p]));
    res.json({ requests: requests.map((r) => ({ id: r.id, ...pMap[r.requester_id] })) });
  } catch (err) { next(err); }
});

// ── POST /api/social/friends/request ────────────────────────────────────────
router.post('/friends/request', authenticate, async (req, res, next) => {
  try {
    const { toId } = req.body;
    if (!toId) return res.status(400).json({ message: 'toId required' });
    const { error } = await supabaseAdmin.from('friendships')
      .insert({ requester_id: req.userId, addressee_id: toId, status: 'pending' });
    if (error) throw error;
    res.status(201).json({ message: 'Friend request sent' });
  } catch (err) { next(err); }
});

// ── POST /api/social/friends/accept ─────────────────────────────────────────
router.post('/friends/accept', authenticate, async (req, res, next) => {
  try {
    const { requestId } = req.body;
    if (!requestId) return res.status(400).json({ message: 'requestId required' });
    const { error } = await supabaseAdmin.from('friendships')
      .update({ status: 'accepted' }).eq('id', requestId).eq('addressee_id', req.userId);
    if (error) throw error;
    res.json({ message: 'Friend request accepted' });
  } catch (err) { next(err); }
});

// ── POST /api/social/friends/decline ────────────────────────────────────────
router.post('/friends/decline', authenticate, async (req, res, next) => {
  try {
    const { requestId } = req.body;
    if (!requestId) return res.status(400).json({ message: 'requestId required' });
    const { error } = await supabaseAdmin.from('friendships')
      .update({ status: 'declined' }).eq('id', requestId).eq('addressee_id', req.userId);
    if (error) throw error;
    res.json({ message: 'Friend request declined' });
  } catch (err) { next(err); }
});

// ── GET /api/social/feed ─────────────────────────────────────────────────────
router.get('/feed', authenticate, async (req, res, next) => {
  try {
    const ids = await friendIds(req.userId);
    if (!ids.length) return res.json({ feed: [] });

    const { data: sessions, error } = await supabaseAdmin.from('run_sessions')
      .select('id, user_id, activity_type, distance_km, xp_earned, created_at')
      .in('user_id', ids).order('created_at', { ascending: false }).limit(30);
    if (error) throw error;

    const uids = [...new Set(sessions.map((s) => s.user_id))];
    const { data: profiles } = await supabaseAdmin
      .from('profiles').select('id, name, avatar').in('id', uids);
    const pMap = Object.fromEntries((profiles || []).map((p) => [p.id, p]));

    res.json({
      feed: sessions.map((s) => ({
        id: s.id, friendName: pMap[s.user_id]?.name, friendAvatar: pMap[s.user_id]?.avatar,
        type: s.activity_type, distanceKm: s.distance_km, xpEarned: s.xp_earned, when: s.created_at,
      })),
    });
  } catch (err) { next(err); }
});

// ── GET /api/social/profile/:userId ─────────────────────────────────────────
router.get('/profile/:userId', authenticate, async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin.from('profiles')
      .select('*').eq('id', req.params.userId).single();
    if (error) throw error;
    res.json({ user: data });
  } catch (err) { next(err); }
});

// ── PUT /api/social/profile/:userId ─────────────────────────────────────────
router.put('/profile/:userId', authenticate, async (req, res, next) => {
  try {
    if (req.params.userId !== req.userId) return res.status(403).json({ message: 'Forbidden' });
    const allowed = ['name', 'avatar', 'push_token'];
    const updates = {};
    allowed.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    const { data, error } = await supabaseAdmin.from('profiles')
      .update(updates).eq('id', req.userId).select().single();
    if (error) throw error;
    res.json({ user: data });
  } catch (err) { next(err); }
});

// ── GET /api/social/search?query= ───────────────────────────────────────────
router.get('/search', authenticate, async (req, res, next) => {
  try {
    const q = req.query.query;
    if (!q) return res.json({ users: [] });
    const { data, error } = await supabaseAdmin.from('profiles')
      .select('id, name, avatar, level').ilike('name', `%${q}%`).neq('id', req.userId).limit(20);
    if (error) throw error;
    res.json({ users: data });
  } catch (err) { next(err); }
});

module.exports = router;
