import { Request, Response, NextFunction } from "express";
import passport from "passport";

/**
 * Require a valid JWT access token.
 * Attaches the user to req.user on success.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  passport.authenticate("jwt", { session: false }, (err: any, user: any) => {
    if (err) return next(err);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized — invalid or expired token" });
    }
    req.user = user;
    next();
  })(req, res, next);
}

/**
 * Require auth AND completed 2FA (if the user has 2FA enabled).
 * Use this on sensitive routes.
 */
export function requireAuthAnd2FA(req: Request, res: Response, next: NextFunction) {
  passport.authenticate("jwt", { session: false }, (err: any, user: any) => {
    if (err) return next(err);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // If 2FA is enabled, the access token must have twoFactorVerified: true
    if (user.twoFactorEnabled && !user.twoFactorVerified) {
      return res.status(403).json({
        error: "2FA verification required",
        code: "2FA_REQUIRED",
      });
    }

    req.user = user;
    next();
  })(req, res, next);
}