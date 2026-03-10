import { Router, Request, Response } from "express";
import passport from "passport";
import { db } from "../database";
import { users, refreshTokens } from "../database/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "../utils/password";
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
  getRefreshTokenExpiry,
} from "../utils/jwt";
import {
  generateTwoFactorSecret,
  generateQRCode,
  verifyTwoFactorToken,
  generateBackupCodes,
  verifyAndConsumeBackupCode,
} from "../utils/twoFactor";
import { requireAuth, requireAuthAnd2FA } from "../middleware/authenticate";
import { authRateLimiter } from "../middleware/ratelimiter";


const router = Router();

// ════════════════════════════════════════════════
// REGISTER
// POST /auth/register
// ════════════════════════════════════════════════

router.post("/register", async (req: Request, res: Response) => {
  try {
    const { username, email, name, password } = req.body;

    // Basic validation
    if (!username || !email || !password) {
      return res.status(400).json({ error: "username, email, and password are required" });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    // Check for existing user
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing) {
      return res.status(409).json({ error: "Email already registered" });
    }

    const passwordHash = await hashPassword(password);

    const [newUser] = await db
      .insert(users)
      .values({
        username,
        email,
        name,
        passwordHash,
        status: "active", // set to "pending_verification" if you add email verification
      })
      .returning({
        id: users.id,
        username: users.username,
        email: users.email,
        name: users.name,
        status: users.status,
        createdAt: users.createdAt,
      });

    res.status(201).json({
      message: "Account created successfully",
      user: newUser,
    });
  } catch (error: any) {
    if (error.code === "23505") { // Postgres unique violation
      return res.status(409).json({ error: "Username or email already taken" });
    }
    res.status(500).json({ error: "Registration failed" });
  }
});

// ════════════════════════════════════════════════
// LOGIN — Step 1: Password
// POST /auth/login
// ════════════════════════════════════════════════

router.post("/login", authRateLimiter(), (req: Request, res: Response, next: any) => {
  passport.authenticate("local", { session: false }, async (err: any, user: any, info: any) => {
    if (err) return next(err);

    if (!user) {
      return res.status(401).json({ error: info?.message || "Invalid credentials" });
    }

    try {
      // If 2FA is enabled → return a partial token, user must complete 2FA next
      if (user.twoFactorEnabled) {
        const tempToken = signAccessToken({
          sub: user.id,
          username: user.username,
          email: user.email,
          twoFactorVerified: false, // NOT yet verified
        });

        return res.json({
          requiresTwoFactor: true,
          tempToken, // client uses this to call POST /auth/2fa/verify
        });
      }

      // No 2FA — issue full tokens immediately
      const accessToken = signAccessToken({
        sub: user.id,
        username: user.username,
        email: user.email,
        twoFactorVerified: false,
      });

      const { token: refreshToken } = signRefreshToken(user.id);

      // Store hashed refresh token in DB
      await db.insert(refreshTokens).values({
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        userAgent: req.headers["user-agent"] || null,
        ipAddress: req.ip || null,
        expiresAt: getRefreshTokenExpiry(),
      });

      // Update last login info
      await db.update(users).set({
        lastLoginAt: new Date(),
        lastLoginIp: req.ip || null,
        updatedAt: new Date(),
      }).where(eq(users.id, user.id));

      res.json({
        accessToken,
        refreshToken,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          name: user.name,
          twoFactorEnabled: user.twoFactorEnabled,
        },
      });
    } catch (error) {
      next(error);
    }
  })(req, res, next);
});

// ════════════════════════════════════════════════
// LOGIN — Step 2: Verify 2FA Code
// POST /auth/2fa/verify
// ════════════════════════════════════════════════

router.post("/2fa/verify", requireAuth, async (req: Request, res: Response) => {
  try {
    const { token: totpToken, backupCode } = req.body;
    const user = req.user as any;

    // Fetch fresh user with 2FA secret
    const [freshUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    if (!freshUser?.twoFactorEnabled || !freshUser.twoFactorSecret) {
      return res.status(400).json({ error: "2FA is not enabled on this account" });
    }

    let verified = false;

    if (totpToken) {
      // Verify TOTP code from authenticator app
      verified = verifyTwoFactorToken(freshUser.twoFactorSecret, totpToken);
    } else if (backupCode) {
      // Verify backup code
      const storedCodes = (freshUser.twoFactorBackupCodes as string[]) || [];
      const { valid, remainingCodes } = verifyAndConsumeBackupCode(backupCode, storedCodes);

      if (valid) {
        // Consume the used backup code
        await db.update(users).set({
          twoFactorBackupCodes: remainingCodes,
          updatedAt: new Date(),
        }).where(eq(users.id, freshUser.id));
        verified = true;
      }
    }

    if (!verified) {
      return res.status(401).json({ error: "Invalid 2FA code" });
    }

    // Issue full access token with twoFactorVerified: true
    const accessToken = signAccessToken({
      sub: freshUser.id,
      username: freshUser.username,
      email: freshUser.email,
      twoFactorVerified: true,
    });

    const { token: refreshToken } = signRefreshToken(freshUser.id);

    await db.insert(refreshTokens).values({
      userId: freshUser.id,
      tokenHash: hashToken(refreshToken),
      userAgent: req.headers["user-agent"] || null,
      ipAddress: req.ip || null,
      expiresAt: getRefreshTokenExpiry(),
    });

    await db.update(users).set({
      lastLoginAt: new Date(),
      lastLoginIp: req.ip || null,
      updatedAt: new Date(),
    }).where(eq(users.id, freshUser.id));

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: freshUser.id,
        username: freshUser.username,
        email: freshUser.email,
        name: freshUser.name,
        twoFactorEnabled: true,
      },
    });
  } catch (error) {
    res.status(500).json({ error: "2FA verification failed" });
  }
});

// ════════════════════════════════════════════════
// REFRESH TOKEN
// POST /auth/refresh
// ════════════════════════════════════════════════

router.post("/refresh", async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: "Refresh token required" });
    }

    // Verify JWT signature first
    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      return res.status(401).json({ error: "Invalid or expired refresh token" });
    }

    const tokenHash = hashToken(refreshToken);

    // Look up stored token
    const [storedToken] = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);

    if (!storedToken) {
      // Token not found — possible replay attack, revoke all tokens for this user
      await db.delete(refreshTokens).where(eq(refreshTokens.userId, payload.sub));
      return res.status(401).json({ error: "Refresh token reuse detected — all sessions revoked" });
    }

    if (storedToken.revokedAt) {
      return res.status(401).json({ error: "Refresh token has been revoked" });
    }

    if (storedToken.expiresAt < new Date()) {
      return res.status(401).json({ error: "Refresh token expired" });
    }

    // Fetch user
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, storedToken.userId))
      .limit(1);

    if (!user || user.status !== "active") {
      return res.status(401).json({ error: "User not found or inactive" });
    }

    // ── Token Rotation ──────────────────────────────
    // Revoke old token, issue new one

    const { token: newRefreshToken } = signRefreshToken(user.id);
    const newTokenHash = hashToken(newRefreshToken);

    // Mark old token as revoked (with pointer to replacement)
    await db.update(refreshTokens).set({
      revokedAt: new Date(),
      replacedByTokenHash: newTokenHash,
    }).where(eq(refreshTokens.id, storedToken.id));

    // Insert new token
    await db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash: newTokenHash,
      userAgent: req.headers["user-agent"] || null,
      ipAddress: req.ip || null,
      expiresAt: getRefreshTokenExpiry(),
    });

    // Issue new access token
    const newAccessToken = signAccessToken({
      sub: user.id,
      username: user.username,
      email: user.email,
      twoFactorVerified: user.twoFactorEnabled ? false : false,
    });

    res.json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (error) {
    res.status(500).json({ error: "Token refresh failed" });
  }
});

// ════════════════════════════════════════════════
// LOGOUT
// POST /auth/logout
// ════════════════════════════════════════════════

router.post("/logout", requireAuth, async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      // Revoke the specific refresh token
      await db.update(refreshTokens).set({
        revokedAt: new Date(),
      }).where(eq(refreshTokens.tokenHash, hashToken(refreshToken)));
    }

    res.json({ message: "Logged out successfully" });
  } catch (error) {
    res.status(500).json({ error: "Logout failed" });
  }
});

// ════════════════════════════════════════════════
// LOGOUT ALL DEVICES
// POST /auth/logout-all
// ════════════════════════════════════════════════

router.post("/logout-all", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user as any;

    await db.delete(refreshTokens).where(eq(refreshTokens.userId, user.id));

    res.json({ message: "Logged out from all devices" });
  } catch (error) {
    res.status(500).json({ error: "Logout failed" });
  }
});

// ════════════════════════════════════════════════
// 2FA SETUP — Step 1: Generate Secret + QR
// POST /auth/2fa/setup
// ════════════════════════════════════════════════

router.post("/2fa/setup", requireAuthAnd2FA, async (req: Request, res: Response) => {
  try {
    const user = req.user as any;

    if (user.twoFactorEnabled) {
      return res.status(400).json({ error: "2FA is already enabled" });
    }

    const { secret, encryptedSecret, otpauthUrl } = generateTwoFactorSecret(user.username);
    const qrCodeDataUrl = await generateQRCode(otpauthUrl);

    // Temporarily store encrypted secret (not enabled yet — user must confirm)
    await db.update(users).set({
      twoFactorSecret: encryptedSecret,
      updatedAt: new Date(),
    }).where(eq(users.id, user.id));

    res.json({
      qrCode: qrCodeDataUrl,    // Render as <img src={qrCode} /> in frontend
      manualEntryKey: secret,   // For users who can't scan QR
      message: "Scan the QR code in your authenticator app, then call POST /auth/2fa/enable with a valid token to confirm",
    });
  } catch (error) {
    res.status(500).json({ error: "2FA setup failed" });
  }
});

// ════════════════════════════════════════════════
// 2FA SETUP — Step 2: Confirm + Enable
// POST /auth/2fa/enable
// ════════════════════════════════════════════════

router.post("/2fa/enable", requireAuthAnd2FA, async (req: Request, res: Response) => {
  try {
    const { token: totpToken } = req.body;
    const user = req.user as any;

    if (!totpToken) {
      return res.status(400).json({ error: "TOTP token required" });
    }

    const [freshUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    if (!freshUser?.twoFactorSecret) {
      return res.status(400).json({ error: "Please call /auth/2fa/setup first" });
    }

    // Verify the token to confirm user set up the app correctly
    const isValid = verifyTwoFactorToken(freshUser.twoFactorSecret, totpToken);

    if (!isValid) {
      return res.status(400).json({ error: "Invalid token — make sure your authenticator is synced" });
    }

    // Generate backup codes
    const { plainCodes, hashedCodes } = generateBackupCodes();

    // Enable 2FA + store backup codes
    await db.update(users).set({
      twoFactorEnabled: true,
      twoFactorBackupCodes: hashedCodes,
      updatedAt: new Date(),
    }).where(eq(users.id, freshUser.id));

    res.json({
      message: "2FA enabled successfully",
      backupCodes: plainCodes, // Show ONCE — user must save these
      warning: "Save these backup codes in a safe place. They will not be shown again.",
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to enable 2FA" });
  }
});

// ════════════════════════════════════════════════
// 2FA DISABLE
// POST /auth/2fa/disable
// ════════════════════════════════════════════════

router.post("/2fa/disable", requireAuthAnd2FA, async (req: Request, res: Response) => {
  try {
    const { token: totpToken, password } = req.body;
    const user = req.user as any;

    if (!user.twoFactorEnabled) {
      return res.status(400).json({ error: "2FA is not enabled" });
    }

    const [freshUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    // Require both TOTP token AND password to disable 2FA
    const { verifyPassword } = await import("../utils/password");
    const passwordValid = await verifyPassword(password, freshUser!.passwordHash);
    if (!passwordValid) {
      return res.status(401).json({ error: "Invalid password" });
    }

    const tokenValid = verifyTwoFactorToken(freshUser!.twoFactorSecret!, totpToken);
    if (!tokenValid) {
      return res.status(401).json({ error: "Invalid 2FA token" });
    }

    await db.update(users).set({
      twoFactorEnabled: false,
      twoFactorSecret: null,
      twoFactorBackupCodes: null,
      updatedAt: new Date(),
    }).where(eq(users.id, freshUser!.id));

    res.json({ message: "2FA disabled successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to disable 2FA" });
  }
});

// ════════════════════════════════════════════════
// GET CURRENT USER
// GET /auth/me
// ════════════════════════════════════════════════

router.get("/me", requireAuth, (req: Request, res: Response) => {
  const user = req.user as any;
  res.json({
    id: user.id,
    username: user.username,
    email: user.email,
    name: user.name,
    status: user.status,
    twoFactorEnabled: user.twoFactorEnabled,
    lastLoginAt: user.lastLoginAt,
  });
});

export default router;