function errorHandler(err, _req, res, _next) {
  console.error('[error]', err.message || err);
  res.status(err.status || 500).json({ message: err.message || 'Internal server error' });
}

module.exports = { errorHandler };
