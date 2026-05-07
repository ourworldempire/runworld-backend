const express      = require('express');
const authenticate = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

// ── GET /api/challenges ───────────────────────────────────────────────────────
// Returns all challenges enriched with: status, participant_count, joined, user_progress
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { data: challenges, error: cErr } = await supabaseAdmin
      .from('challenges')
      .select('*')
      .order('start_date');
    if (cErr) throw cErr;

    if (!challenges?.length) return res.json({ challenges: [] });

    const challengeIds = challenges.map((c) => c.id);

    // User's join / progress records
    const { data: myParts } = await supabaseAdmin
      .from('challenge_participants')
      .select('challenge_id, progress, completed')
      .eq('user_id', req.userId);

    const myMap = Object.fromEntries(
      (myParts || []).map((p) => [p.challenge_id, p]),
    );

    // Participant counts per challenge
    const { data: allParts } = await supabaseAdmin
      .from('challenge_participants')
      .select('challenge_id')
      .in('challenge_id', challengeIds);

    const countMap = {};
    (allParts || []).forEach((p) => {
      countMap[p.challenge_id] = (countMap[p.challenge_id] || 0) + 1;
    });

    const now = new Date();
    const result = challenges.map((c) => {
      const myPart   = myMap[c.id] ?? null;
      const started  = new Date(c.start_date) <= now;
      const ended    = new Date(c.end_date)   <  now;

      let status;
      if (myPart?.completed)        status = 'completed';
      else if (ended && myPart)     status = 'completed'; // expired, user participated
      else if (!started)            status = 'upcoming';
      else if (started && !ended)   status = 'active';
      else                          status = 'completed'; // expired, never joined — still show

      return {
        ...c,
        participant_count: countMap[c.id] ?? 0,
        joined:            !!myPart,
        user_progress:     myPart?.progress  ?? 0,
        user_completed:    myPart?.completed ?? false,
        status,
      };
    });

    res.json({ challenges: result });
  } catch (err) { next(err); }
});

// ── POST /api/challenges/:id/join ─────────────────────────────────────────────
router.post('/:id/join', authenticate, async (req, res, next) => {
  try {
    const { data: c, error: cErr } = await supabaseAdmin
      .from('challenges').select('id, end_date').eq('id', req.params.id).single();
    if (cErr || !c) return res.status(404).json({ message: 'Challenge not found' });
    if (new Date(c.end_date) < new Date()) {
      return res.status(400).json({ message: 'Challenge has already ended' });
    }

    const { error } = await supabaseAdmin
      .from('challenge_participants')
      .upsert(
        { challenge_id: req.params.id, user_id: req.userId },
        { onConflict: 'challenge_id,user_id', ignoreDuplicates: true },
      );
    if (error) throw error;

    res.json({ joined: true });
  } catch (err) { next(err); }
});

// ── DELETE /api/challenges/:id/join ──────────────────────────────────────────
router.delete('/:id/join', authenticate, async (req, res, next) => {
  try {
    const { error } = await supabaseAdmin
      .from('challenge_participants')
      .delete()
      .eq('challenge_id', req.params.id)
      .eq('user_id', req.userId);
    if (error) throw error;

    res.json({ left: true });
  } catch (err) { next(err); }
});

module.exports = router;
