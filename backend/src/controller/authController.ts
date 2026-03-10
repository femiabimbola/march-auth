import { Request, Response, NextFunction } from "express";
import passport from "passport";
import { db } from "../database";
import { users, refreshTokens } from "../database/schema";
import { eq } from "drizzle-orm";
import { hashPassword, verifyPassword } from "../utils/password";
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

// ════════════════════════════════════════════════
// REGISTER
// ════════════════════════════════════════════════

export async function register(req: Request, res: Response): Promise<any> {
  try {
    const { username, email, name, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: "username, email, and password are required" });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

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
        status: "active",
      })
      .returning({
        id: users.id,
        username: users.username,
        email: users.email,
        name: users.name,
        status: users.status,
        createdAt: users.createdAt,
      });

    return res.status(201).json({
      message: "Account created successfully",
      user: newUser,
    });
  } catch (error: any) {
    if (error.code === "23505") {
      return res.status(409).json({ error: "Username or email already taken" });
    }
    return res.status(500).json({ error: "Registration failed" });
  }
}

// ════════════════════════════════════════════════
// LOGIN — Step 1: Password
// ════════════════════════════════════════════════

export function login(req: Request, res: Response, next: NextFunction): void {
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
          twoFactorVerified: false,
        });

        return res.json({
          requiresTwoFactor: true,
          tempToken,
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

      await db.insert(refreshTokens).values({
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        userAgent: req.headers["user-agent"] || null,
        ipAddress: req.ip || null,
        expiresAt: getRefreshTokenExpiry(),
      });

      await db.update(users).set({
        lastLoginAt: new Date(),
        lastLoginIp: req.ip || null,
        updatedAt: new Date(),
      }).where(eq(users.id, user.id));

      return res.json({
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
      return next(error);
    }
  })(req, res, next);
}

// ════════════════════════════════════════════════
// LOGIN — Step 2: Verify 2FA Code
// ════════════════════════════════════════════════

export async function verifyTwoFactor(req: Request, res: Response): Promise<any> {
  try {
    const { token: totpToken, backupCode } = req.body;
    const user = req.user as any;

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
      verified = verifyTwoFactorToken(freshUser.twoFactorSecret, totpToken);
    } else if (backupCode) {
      const storedCodes = (freshUser.twoFactorBackupCodes as string[]) || [];
      const { valid, remainingCodes } = verifyAndConsumeBackupCode(backupCode, storedCodes);

      if (valid) {
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

    return res.json({
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
    return res.status(500).json({ error: "2FA verification failed" });
  }
}

// ════════════════════════════════════════════════
// REFRESH TOKEN
// ════════════════════════════════════════════════

export async function refreshToken(req: Request, res: Response): Promise<any> {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: "Refresh token required" });
    }

    let payload;
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      return res.status(401).json({ error: "Invalid or expired refresh token" });
    }

    const tokenHash = hashToken(refreshToken);

    const [storedToken] = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);

    if (!storedToken) {
      // Possible replay attack — revoke all sessions for this user
      await db.delete(refreshTokens).where(eq(refreshTokens.userId, payload.sub));
      return res.status(401).json({ error: "Refresh token reuse detected — all sessions revoked" });
    }

    if (storedToken.revokedAt) {
      return res.status(401).json({ error: "Refresh token has been revoked" });
    }

    if (storedToken.expiresAt < new Date()) {
      return res.status(401).json({ error: "Refresh token expired" });
    }

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, storedToken.userId))
      .limit(1);

    if (!user || user.status !== "active") {
      return res.status(401).json({ error: "User not found or inactive" });
    }

    // Rotate — revoke old, issue new
    const { token: newRefreshToken } = signRefreshToken(user.id);
    const newTokenHash = hashToken(newRefreshToken);

    await db.update(refreshTokens).set({
      revokedAt: new Date(),
      replacedByTokenHash: newTokenHash,
    }).where(eq(refreshTokens.id, storedToken.id));

    await db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash: newTokenHash,
      userAgent: req.headers["user-agent"] || null,
      ipAddress: req.ip || null,
      expiresAt: getRefreshTokenExpiry(),
    });

    const newAccessToken = signAccessToken({
      sub: user.id,
      username: user.username,
      email: user.email,
      twoFactorVerified: false,
    });

    return res.json({
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (error) {
    return res.status(500).json({ error: "Token refresh failed" });
  }
}

// ════════════════════════════════════════════════
// LOGOUT
// ════════════════════════════════════════════════

export async function logout(req: Request, res: Response): Promise<any> {
  try {
    const { refreshToken } = req.body;

    if (refreshToken) {
      await db.update(refreshTokens).set({
        revokedAt: new Date(),
      }).where(eq(refreshTokens.tokenHash, hashToken(refreshToken)));
    }

    return res.json({ message: "Logged out successfully" });
  } catch (error) {
    return res.status(500).json({ error: "Logout failed" });
  }
}

// ════════════════════════════════════════════════
// LOGOUT ALL DEVICES
// ════════════════════════════════════════════════

export async function logoutAll(req: Request, res: Response): Promise<any> {
  try {
    const user = req.user as any;

    await db.delete(refreshTokens).where(eq(refreshTokens.userId, user.id));

    return res.json({ message: "Logged out from all devices" });
  } catch (error) {
    return res.status(500).json({ error: "Logout failed" });
  }
}

// ════════════════════════════════════════════════
// 2FA SETUP — Step 1: Generate Secret + QR
// ════════════════════════════════════════════════

export async function setupTwoFactor(req: Request, res: Response): Promise<any> {
  try {
    const user = req.user as any;

    if (user.twoFactorEnabled) {
      return res.status(400).json({ error: "2FA is already enabled" });
    }

    const { secret, encryptedSecret, otpauthUrl } = generateTwoFactorSecret(user.username);
    const qrCodeDataUrl = await generateQRCode(otpauthUrl);

    await db.update(users).set({
      twoFactorSecret: encryptedSecret,
      updatedAt: new Date(),
    }).where(eq(users.id, user.id));

    return res.json({
      qrCode: qrCodeDataUrl,
      manualEntryKey: secret,
      message: "Scan the QR code in your authenticator app, then call POST /auth/2fa/enable with a valid token to confirm",
    });
  } catch (error) {
    return res.status(500).json({ error: "2FA setup failed" });
  }
}

// ════════════════════════════════════════════════
// 2FA SETUP — Step 2: Confirm + Enable
// ════════════════════════════════════════════════

export async function enableTwoFactor(req: Request, res: Response): Promise<any> {
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

    const isValid = verifyTwoFactorToken(freshUser.twoFactorSecret, totpToken);

    if (!isValid) {
      return res.status(400).json({ error: "Invalid token — make sure your authenticator is synced" });
    }

    const { plainCodes, hashedCodes } = generateBackupCodes();

    await db.update(users).set({
      twoFactorEnabled: true,
      twoFactorBackupCodes: hashedCodes,
      updatedAt: new Date(),
    }).where(eq(users.id, freshUser.id));

    return res.json({
      message: "2FA enabled successfully",
      backupCodes: plainCodes,
      warning: "Save these backup codes in a safe place. They will not be shown again.",
    });
  } catch (error) {
    return res.status(500).json({ error: "Failed to enable 2FA" });
  }
}

// ════════════════════════════════════════════════
// 2FA DISABLE
// ════════════════════════════════════════════════

export async function disableTwoFactor(req: Request, res: Response): Promise<any> {
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

    return res.json({ message: "2FA disabled successfully" });
  } catch (error) {
    return res.status(500).json({ error: "Failed to disable 2FA" });
  }
}

// ════════════════════════════════════════════════
// GET CURRENT USER
// ════════════════════════════════════════════════

export function getMe(req: Request, res: Response): void {
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
}