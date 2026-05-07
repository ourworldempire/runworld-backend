const express    = require('express');
const authenticate = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');
const { checkAndAwardBadges } = require('../utils/badgeChecker');

const router = express.Router();

// ── POST /api/fitness/sessions — save a completed run ───────────────────────
router.post('/sessions', authenticate, async (req, res, next) => {
  try {
    const {
      activity_type = 'running', distance_km = 0, duration_seconds = 0,
      steps = 0, calories = 0, xp_earned = 0, territory_captured = 0,
      path_coordinates = [], badges_unlocked = [],
    } = req.body;

    const { data: session, error } = await supabaseAdmin.from('run_sessions').insert({
      user_id: req.userId, activity_type, distance_km, duration_seconds,
      steps, calories, xp_earned, territory_captured, path_coordinates, badges_unlocked,
    }).select().single();
    if (error) throw error;

    // Update profile totals + XP leveling
    const { data: p } = await supabaseAdmin.from('profiles')
      .select('total_distance_km, total_steps, xp, xp_to_next, level').eq('id', req.userId).single();

    if (p) {
      let xp        = p.xp + xp_earned;
      let level     = p.level;
      let xpToNext  = p.xp_to_next;
      while (xp >= xpToNext) { xp -= xpToNext; level++; xpToNext = Math.round(xpToNext * 1.3); }
      await supabaseAdmin.from('profiles').update({
        total_distance_km: p.total_distance_km + distance_km,
        total_steps:       p.total_steps + steps,
        xp, level, xp_to_next: xpToNext,
      }).eq('id', req.userId);
    }

    // Badge check — run after profile is updated so streak/distance are current
    const { count: sessionCount } = await supabaseAdmin
      .from('run_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.userId);

    const updatedProfile = p
      ? { ...p, total_distance_km: p.total_distance_km + distance_km }
      : null;

    const newBadges = updatedProfile
      ? await checkAndAwardBadges(req.userId, updatedProfile, session, sessionCount ?? 1)
      : [];

    // Update progress for any active joined challenges
    await updateChallengeProgress(req.userId, session);

    res.status(201).json({ session, newBadges });
  } catch (err) { next(err); }
});

// ── GET /api/fitness/sessions — paginated run history ───────────────────────
router.get('/sessions', authenticate, async (req, res, next) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit)  || 20, 100);
    const offset = parseInt(req.query.offset) || 0;

    const { data, error } = await supabaseAdmin.from('run_sessions')
      .select('*').eq('user_id', req.userId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;
    res.json({ sessions: data });
  } catch (err) { next(err); }
});

// ── GET /api/fitness/stats/weekly ────────────────────────────────────────────
router.get('/stats/weekly', authenticate, async (req, res, next) => {
  try {
    const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
    const { data, error } = await supabaseAdmin.from('run_sessions')
      .select('distance_km, steps, calories, created_at')
      .eq('user_id', req.userId).gte('created_at', weekAgo);
    if (error) throw error;

    const DAY_NAMES = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const dayMap = Object.fromEntries(DAY_NAMES.map((d) => [d, { day: d, steps: 0, distanceKm: 0, calories: 0 }]));

    data.forEach((s) => {
      const dow = new Date(s.created_at).getDay(); // 0=Sun..6=Sat
      const key = DAY_NAMES[dow === 0 ? 6 : dow - 1];
      dayMap[key].steps      += s.steps       || 0;
      dayMap[key].distanceKm += s.distance_km || 0;
      dayMap[key].calories   += s.calories    || 0;
    });

    const totals = data.reduce(
      (a, s) => ({ runs: a.runs+1, steps: a.steps+(s.steps||0), distanceKm: a.distanceKm+(s.distance_km||0), calories: a.calories+(s.calories||0) }),
      { runs: 0, steps: 0, distanceKm: 0, calories: 0 }
    );

    res.json({ days: Object.values(dayMap), totals });
  } catch (err) { next(err); }
});

// ── GET /api/fitness/stats/today ─────────────────────────────────────────────
router.get('/stats/today', authenticate, async (req, res, next) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const { data, error } = await supabaseAdmin.from('run_sessions')
      .select('distance_km, steps, calories, duration_seconds')
      .eq('user_id', req.userId).gte('created_at', today.toISOString());
    if (error) throw error;

    const stats = data.reduce(
      (a, s) => ({ steps: a.steps+(s.steps||0), distanceKm: a.distanceKm+(s.distance_km||0), calories: a.calories+(s.calories||0), activeMinutes: a.activeMinutes+Math.round((s.duration_seconds||0)/60) }),
      { steps: 0, distanceKm: 0, calories: 0, activeMinutes: 0 }
    );
    res.json(stats);
  } catch (err) { next(err); }
});

// ── Challenge progress update (called after every session save) ───────────────
async function updateChallengeProgress(userId, session) {
  const { data: joined } = await supabaseAdmin
    .from('challenge_participants')
    .select('challenge_id, progress, challenges(type, goal_value, start_date, end_date)')
    .eq('user_id', userId)
    .eq('completed', false);

  if (!joined?.length) return;

  const now = new Date();
  const active = joined.filter((p) => {
    const c = p.challenges;
    return c && new Date(c.start_date) <= now && new Date(c.end_date) >= now;
  });

  for (const p of active) {
    const c = p.challenges;
    let delta = 0;

    if (c.type === 'distance') {
      delta = session.distance_km || 0;
    } else if (c.type === 'territory') {
      delta = session.territory_captured || 0;
    } else if (c.type === 'speed') {
      // Goal: 5km in 25min (12 km/h). delta = 1 only if achieved this session.
      const kmh = (session.distance_km || 0) / ((session.duration_seconds || 1) / 3600);
      if ((session.distance_km || 0) >= 5 && kmh >= 12) delta = 1;
    } else if (c.type === 'streak') {
      // Streak is profile-owned; treat each session as +1 day toward goal (capped by goal)
      delta = 1;
    }

    if (delta === 0) continue;

    const newProgress = Math.min(p.progress + delta, c.goal_value);
    const completed   = newProgress >= c.goal_value;

    await supabaseAdmin
      .from('challenge_participants')
      .update({ progress: newProgress, completed })
      .eq('challenge_id', p.challenge_id)
      .eq('user_id', userId);
  }
}

module.exports = router;
