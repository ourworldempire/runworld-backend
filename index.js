require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes         = require('./src/routes/auth.routes');
const fitnessRoutes      = require('./src/routes/fitness.routes');
const territoryRoutes    = require('./src/routes/territory.routes');
const leaderboardRoutes  = require('./src/routes/leaderboard.routes');
const socialRoutes       = require('./src/routes/social.routes');
const notifRoutes        = require('./src/routes/notifications.routes');
const achievementsRoutes  = require('./src/routes/achievements.routes');
const challengesRoutes    = require('./src/routes/challenges.routes');
const { errorHandler }        = require('./src/middleware/errorHandler');
const { startStreakResetCron } = require('./src/cron/streakReset');

const app  = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date() }));

app.use('/api/auth',          authRoutes);
app.use('/api/fitness',       fitnessRoutes);
app.use('/api/map',           territoryRoutes);
app.use('/api/leaderboard',   leaderboardRoutes);
app.use('/api/social',        socialRoutes);
app.use('/api/notifications', notifRoutes);
app.use('/api/achievements',  achievementsRoutes);
app.use('/api/challenges',    challengesRoutes);

app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`RunWorld API → http://localhost:${PORT}`);
  startStreakResetCron();
});
