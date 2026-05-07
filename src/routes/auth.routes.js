const express   = require('express');
const jwt       = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const sgMail    = require('@sendgrid/mail');
const { supabase, supabaseAdmin } = require('../config/supabase');
const authenticate = require('../middleware/auth');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const router         = express.Router();
const JWT_SECRET     = process.env.JWT_SECRET;
const ACCESS_EXPIRY  = '15m';
const REFRESH_DAYS   = 30;

function signAccess(userId, email) {
  return jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: ACCESS_EXPIRY });
}

async function issueRefresh(userId) {
  const token     = uuid();
  const expiresAt = new Date(Date.now() + REFRESH_DAYS * 86400_000).toISOString();
  await supabaseAdmin.from('refresh_tokens').insert({ user_id: userId, token, expires_at: expiresAt });
  return token;
}

// ── POST /api/auth/signup ────────────────────────────────────────────────────
router.post('/signup', async (req, res, next) => {
  try {
    const { name, email, password, avatar = '🏃' } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'name, email and password are required' });
    }

    const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (authErr) {
      const msg = authErr.message?.toLowerCase() || '';
      if (msg.includes('already') || msg.includes('exists')) {
        return res.status(409).json({ message: 'Email already in use' });
      }
      throw authErr;
    }

    const userId = authData.user.id;
    const profile = { id: userId, name, email, avatar };
    const { error: profErr } = await supabaseAdmin.from('profiles').insert(profile);
    if (profErr) throw profErr;

    const accessToken  = signAccess(userId, email);
    const refreshToken = await issueRefresh(userId);
    res.status(201).json({ accessToken, refreshToken, user: { ...profile, level: 1, xp: 0, xp_to_next: 1000, streak: 0 } });
  } catch (err) { next(err); }
});

// ── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'email and password are required' });

    const { data: authData, error: authErr } = await supabase.auth.signInWithPassword({ email, password });
    if (authErr) return res.status(401).json({ message: 'Invalid email or password' });

    const userId = authData.user.id;
    const { data: profile, error: profErr } = await supabaseAdmin.from('profiles').select('*').eq('id', userId).single();
    if (profErr) throw profErr;

    const accessToken  = signAccess(userId, email);
    const refreshToken = await issueRefresh(userId);
    res.json({ accessToken, refreshToken, user: profile });
  } catch (err) { next(err); }
});

// ── POST /api/auth/refresh ───────────────────────────────────────────────────
router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ message: 'refreshToken required' });

    const { data: row, error } = await supabaseAdmin
      .from('refresh_tokens').select('*').eq('token', refreshToken).eq('revoked', false).single();
    if (error || !row) return res.status(401).json({ message: 'Invalid refresh token' });
    if (new Date(row.expires_at) < new Date()) return res.status(401).json({ message: 'Refresh token expired' });

    await supabaseAdmin.from('refresh_tokens').update({ revoked: true }).eq('id', row.id);

    const { data: p } = await supabaseAdmin.from('profiles').select('email').eq('id', row.user_id).single();
    const newAccess  = signAccess(row.user_id, p.email);
    const newRefresh = await issueRefresh(row.user_id);
    res.json({ accessToken: newAccess, refreshToken: newRefresh });
  } catch (err) { next(err); }
});

// ── POST /api/auth/logout ────────────────────────────────────────────────────
router.post('/logout', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await supabaseAdmin.from('refresh_tokens').update({ revoked: true }).eq('token', refreshToken);
    }
    res.status(204).send();
  } catch (err) { next(err); }
});

// ── POST /api/auth/google ────────────────────────────────────────────────────
router.post('/google', async (req, res, next) => {
  try {
    const { googleAccessToken } = req.body;
    if (!googleAccessToken) return res.status(400).json({ message: 'googleAccessToken required' });

    const gRes = await fetch(`https://www.googleapis.com/oauth2/v1/userinfo?access_token=${googleAccessToken}`);
    if (!gRes.ok) return res.status(401).json({ message: 'Invalid Google token' });
    const gUser = await gRes.json();

    const { data: existing } = await supabaseAdmin.from('profiles').select('*').eq('email', gUser.email).single();

    let profile = existing;
    let userId  = existing?.id;

    if (!existing) {
      const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
        email: gUser.email, email_confirm: true,
      });
      if (authErr) throw authErr;
      userId = authData.user.id;
      const newProfile = { id: userId, name: gUser.name, email: gUser.email, avatar: '🏃' };
      await supabaseAdmin.from('profiles').insert(newProfile);
      profile = newProfile;
    }

    const accessToken  = signAccess(userId, gUser.email);
    const refreshToken = await issueRefresh(userId);
    res.json({ accessToken, refreshToken, user: profile });
  } catch (err) { next(err); }
});

// ── POST /api/auth/forgot-password/send-otp ─────────────────────────────────
router.post('/forgot-password/send-otp', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'email required' });

    const { data: profile } = await supabaseAdmin.from('profiles').select('id').eq('email', email).single();
    // Always 200 — prevents email enumeration
    if (!profile) return res.json({ message: 'If that email exists, a code was sent' });

    const code      = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    await supabaseAdmin.from('otp_codes').insert({ email, code, expires_at: expiresAt });

    await sgMail.send({
      to: email,
      from: process.env.SENDGRID_FROM_EMAIL,
      subject: 'RunWorld — Password reset code',
      text: `Your RunWorld password reset code is: ${code}\n\nExpires in 10 minutes.`,
      html: `<p>Your RunWorld password reset code is: <strong style="font-size:24px">${code}</strong></p><p>Expires in 10 minutes.</p>`,
    });

    res.json({ message: 'If that email exists, a code was sent' });
  } catch (err) { next(err); }
});

// ── POST /api/auth/forgot-password/verify-otp ───────────────────────────────
router.post('/forgot-password/verify-otp', async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ message: 'email and otp required' });

    const { data: record } = await supabaseAdmin
      .from('otp_codes').select('*')
      .eq('email', email).eq('code', otp).eq('used', false)
      .order('created_at', { ascending: false }).limit(1).single();

    if (!record)                                    return res.status(400).json({ message: 'Invalid or expired code' });
    if (new Date(record.expires_at) < new Date())   return res.status(400).json({ message: 'Code expired' });

    await supabaseAdmin.from('otp_codes').update({ used: true }).eq('id', record.id);

    // Embed email in a short-lived JWT used as the reset token
    const resetToken = jwt.sign({ email, purpose: 'password_reset' }, JWT_SECRET, { expiresIn: '15m' });
    res.json({ resetToken });
  } catch (err) { next(err); }
});

// ── POST /api/auth/forgot-password/reset ────────────────────────────────────
router.post('/forgot-password/reset', async (req, res, next) => {
  try {
    const { resetToken, newPassword } = req.body;
    if (!resetToken || !newPassword) return res.status(400).json({ message: 'resetToken and newPassword required' });
    if (newPassword.length < 8)      return res.status(400).json({ message: 'Password must be at least 8 characters' });

    let payload;
    try { payload = jwt.verify(resetToken, JWT_SECRET); }
    catch { return res.status(400).json({ message: 'Invalid or expired reset token' }); }

    if (payload.purpose !== 'password_reset') return res.status(400).json({ message: 'Invalid reset token' });

    const { data: profile } = await supabaseAdmin.from('profiles').select('id').eq('email', payload.email).single();
    if (!profile) return res.status(404).json({ message: 'User not found' });

    const { error } = await supabaseAdmin.auth.admin.updateUserById(profile.id, { password: newPassword });
    if (error) throw error;

    res.json({ message: 'Password updated successfully' });
  } catch (err) { next(err); }
});

// ── DELETE /api/auth/account ─────────────────────────────────────────────────
router.delete('/account', authenticate, async (req, res, next) => {
  try {
    const userId = req.userId;

    // Revoke all refresh tokens immediately — prevents new access tokens
    // being issued during the brief window before the profile row is deleted.
    await supabaseAdmin
      .from('refresh_tokens')
      .update({ revoked: true })
      .eq('user_id', userId);

    // Delete profile — cascades to: run_sessions, friendships, refresh_tokens,
    // achievements, challenge_participants (all have ON DELETE CASCADE).
    const { error: profErr } = await supabaseAdmin
      .from('profiles')
      .delete()
      .eq('id', userId);
    if (profErr) throw profErr;

    // Remove from Supabase Auth — must come after profile delete because
    // auth.admin.deleteUser does not cascade to our custom tables.
    const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (authErr) throw authErr;

    res.status(204).send();
  } catch (err) { next(err); }
});

module.exports = router;
