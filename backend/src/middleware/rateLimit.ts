import rateLimit from 'express-rate-limit';

// Baseline limiter for every API route (NFR from the Feinkonzept: rate
// limits on auth and game actions).
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

// Tighter limiter for credential- and invite-guessing surfaces.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});
