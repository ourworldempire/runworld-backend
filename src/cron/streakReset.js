const cron          = require('node-cron');
const { supabaseAdmin } = require('../config/supabase');

/**
 * Runs at 00:05 every day (server local time).
 * Resets streak to 0 for any user whose most recent run_session
 * was created more than 24 hours ago (i.e. no run yesterday).
 *
 * A user is exempt if they ran today (within the last 24h), or
 * if their streak is already 0 (nothing to reset).
 */
function startStreakResetCron() {
  cron.schedule('5 0 * * *', async () => {
    console.log('[cron] streak-reset — starting');
    try {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      // Find all users with streak > 0 whose last session is older than 24h
      // (or who have never run at all).
      // Strategy: get all profile IDs with streak > 0, then filter out
      // those who have a session in the last 24h.

      const { data: activeProfiles, error: pErr } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .gt('streak', 0);

      if (pErr) throw pErr;
      if (!activeProfiles?.length) {
        console.log('[cron] streak-reset — no users with active streak, skipping');
        return;
      }

      const profileIds = activeProfiles.map((p) => p.id);

      // Users who DID run in the last 24h — exempt from reset
      const { data: recentRunners, error: rErr } = await supabaseAdmin
        .from('run_sessions')
        .select('user_id')
        .in('user_id', profileIds)
        .gte('created_at', cutoff);

      if (rErr) throw rErr;

      const exemptIds = new Set((recentRunners || []).map((r) => r.user_id));
      const toReset   = profileIds.filter((id) => !exemptIds.has(id));

      if (!toReset.length) {
        console.log('[cron] streak-reset — all active users ran recently, nothing to reset');
        return;
      }

      const { error: uErr } = await supabaseAdmin
        .from('profiles')
        .update({ streak: 0 })
        .in('id', toReset);

      if (uErr) throw uErr;

      console.log(`[cron] streak-reset — reset ${toReset.length} user(s)`);
    } catch (err) {
      console.error('[cron] streak-reset — error:', err.message);
    }
  });

  console.log('[cron] streak-reset scheduled — runs daily at 00:05');
}

module.exports = { startStreakResetCron };
