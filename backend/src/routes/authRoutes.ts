import { Router } from "express";
import {
  register,
  login,
  verifyTwoFactor,
  refreshToken,
  logout,
  logoutAll,
  setupTwoFactor,
  enableTwoFactor,
  disableTwoFactor,
  getMe,
} from "../controller/authController";
import { requireAuth, requireAuthAnd2FA } from "../middleware/authenticate";
import { authRateLimiter } from "../middleware/ratelimiter";

const router = Router();

// ── Auth ──────────────────────────────────────────────
router.post("/register", register);
router.post("/login", authRateLimiter(), login);
router.post("/refresh", refreshToken);

// ── Session ───────────────────────────────────────────
router.post("/logout", requireAuth, logout);
router.post("/logout-all", requireAuth, logoutAll);

// ── Current User ──────────────────────────────────────
router.get("/me", requireAuth, getMe);

// ── 2FA ───────────────────────────────────────────────
router.post("/2fa/verify", requireAuth, verifyTwoFactor);
router.post("/2fa/setup", requireAuthAnd2FA, setupTwoFactor);
router.post("/2fa/enable", requireAuthAnd2FA, enableTwoFactor);
router.post("/2fa/disable", requireAuthAnd2FA, disableTwoFactor);

export default router;