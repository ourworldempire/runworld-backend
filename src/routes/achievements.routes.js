const express      = require('express');
const authenticate = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

// ── GET /api/achievements ─────────────────────────────────────────────────────
// Returns all earned badges for the current user.
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('achievements')
      .select('badge_id, earned_at')
      .eq('user_id', req.userId)
      .order('earned_at', { ascending: false });
    if (error) throw error;
    res.json({ achievements: data || [] });
  } catch (err) { next(err); }
});

// ── GET /api/achievements/user/:userId ───────────────────────────────────────
// Returns earned badges for any user (for profile viewing).
router.get('/user/:userId', authenticate, async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('achievements')
      .select('badge_id, earned_at')
      .eq('user_id', req.params.userId)
      .order('earned_at', { ascending: false });
    if (error) throw error;
    res.json({ achievements: data || [] });
  } catch (err) { next(err); }
});

module.exports = router;
