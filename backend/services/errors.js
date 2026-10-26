/*
 * errors.js - one error type for every failure we want to explain to the user
 * (bad input, search service down, no road route, ...). Controllers turn it
 * into { error, code, details } JSON so the UI can show a precise message
 * instead of silently falling back to fake data.
 */

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function sendError(res, err) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, code: err.code, details: err.details });
  }
  console.error(err);
  return res.status(500).json({ error: err.message || "Unexpected server error", code: "INTERNAL" });
}

module.exports = { ApiError, sendError };
