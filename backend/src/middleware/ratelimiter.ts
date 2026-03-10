import { Request, Response, NextFunction } from "express";

// Simple in-memory rate limiter for auth endpoints
// In production, replace with redis-based solution (e.g. express-rate-limit + rate-limit-redis)
const attempts = new Map<string, { count: number; resetAt: number }>();

export function authRateLimiter(
  maxAttempts = 10,
  windowMs = 15 * 60 * 1000 // 15 minutes
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || "unknown";
    const now = Date.now();
    const record = attempts.get(key);

    if (!record || record.resetAt < now) {
      attempts.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    record.count++;

    if (record.count > maxAttempts) {
      return res.status(429).json({
        error: "Too many requests. Please try again later.",
      });
    }

    next();
  };
}