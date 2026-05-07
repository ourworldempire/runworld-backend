const express    = require('express');
const authenticate = require('../middleware/auth');
const { supabaseAdmin } = require('../config/supabase');

const router = express.Router();

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

// ── POST /api/notifications/register — store Expo push token ────────────────
router.post('/register', authenticate, async (req, res, next) => {
  try {
    const { pushToken } = req.body;
    if (!pushToken) return res.status(400).json({ message: 'pushToken required' });
    const { error } = await supabaseAdmin.from('profiles')
      .update({ push_token: pushToken }).eq('id', req.userId);
    if (error) throw error;
    res.json({ message: 'Push token registered' });
  } catch (err) { next(err); }
});

// ── POST /api/notifications/send — send Expo push to a user ─────────────────
router.post('/send', authenticate, async (req, res, next) => {
  try {
    const { toUserId, title, body, data: payload } = req.body;
    if (!toUserId || !title || !body) {
      return res.status(400).json({ message: 'toUserId, title and body required' });
    }

    const { data: profile } = await supabaseAdmin.from('profiles')
      .select('push_token').eq('id', toUserId).single();
    if (!profile?.push_token) return res.json({ message: 'User has no push token' });

    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        to: profile.push_token, title, body,
        data: payload || {}, sound: 'default',
      }),
    });

    const result = await response.json();
    res.json({ result });
  } catch (err) { next(err); }
});

module.exports = router;
