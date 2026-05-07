const { supabaseAdmin } = require('../config/supabase');

// Badges that can be auto-awarded from session + profile data at run-save time.
// Social badges (first_friend, squad_up) are awarded from social.routes.js separately.
const SESSION_BADGE_CHECKS = [
  {
    id: 'first_run',
    check: ({ sessionCount }) => sessionCount >= 1,
  },
  {
    id: 'run_5k',
    check: ({ session }) => session.distance_km >= 5,
  },
  {
    id: 'run_10k',
    check: ({ session }) => session.distance_km >= 10,
  },
  {
    id: 'run_50k',
    check: ({ profile }) => profile.total_distance_km >= 50,
  },
  {
    id: 'morning_runner',
    // Session saved between 05:00–08:59 local server time
    check: ({ now }) => { const h = now.getHours(); return h >= 5 && h < 9; },
  },
  {
    id: 'speed_demon',
    // Average pace <= 5 min/km  ≡  avg speed >= 12 km/h
    check: ({ session }) => {
      if (!session.distance_km || !session.duration_seconds) return false;
      return (session.distance_km / session.duration_seconds) * 3600 >= 12;
    },
  },
  {
    id: 'first_capture',
    check: ({ session }) => (session.territory_captured || 0) > 0,
  },
  {
    id: 'night_raider',
    // Session saved between 21:00–23:59
    check: ({ now }) => now.getHours() >= 21,
  },
  {
    id: 'streak_3',
    check: ({ profile }) => profile.streak >= 3,
  },
  {
    id: 'streak_7',
    check: ({ profile }) => profile.streak >= 7,
  },
  {
    id: 'streak_30',
    check: ({ profile }) => profile.streak >= 30,
  },
  {
    id: 'streak_100',
    check: ({ profile }) => profile.streak >= 100,
  },
];

/**
 * Checks all badge conditions and inserts newly earned badges.
 * Returns array of newly awarded badge IDs (empty if none).
 *
 * @param {string} userId
 * @param {object} profile  — updated profile row (post XP/level/streak write)
 * @param {object} session  — just-saved run_session row
 * @param {number} sessionCount — total sessions for this user including the new one
 */
async function checkAndAwardBadges(userId, profile, session, sessionCount) {
  const now = new Date();
  const ctx = { session, profile, now, sessionCount };

  const candidateIds = SESSION_BADGE_CHECKS
    .filter((b) => b.check(ctx))
    .map((b) => b.id);

  if (!candidateIds.length) return [];

  // Fetch already-earned badge IDs to avoid duplicate inserts
  const { data: existing } = await supabaseAdmin
    .from('achievements')
    .select('badge_id')
    .eq('user_id', userId)
    .in('badge_id', candidateIds);

  const existingIds = new Set((existing || []).map((e) => e.badge_id));
  const newBadgeIds = candidateIds.filter((id) => !existingIds.has(id));

  if (!newBadgeIds.length) return [];

  await supabaseAdmin.from('achievements').insert(
    newBadgeIds.map((badge_id) => ({ user_id: userId, badge_id })),
  );

  return newBadgeIds;
}

/**
 * Awards a single badge if not already earned. Used for social badges.
 * Returns true if badge was newly awarded.
 */
async function awardBadge(userId, badgeId) {
  const { data: existing } = await supabaseAdmin
    .from('achievements')
    .select('id')
    .eq('user_id', userId)
    .eq('badge_id', badgeId)
    .single();

  if (existing) return false;

  await supabaseAdmin.from('achievements').insert({ user_id: userId, badge_id: badgeId });
  return true;
}

module.exports = { checkAndAwardBadges, awardBadge };
