import jwt from "jsonwebtoken";
import crypto from "crypto";

// ── Types ──────────────────────────────────────────────

export interface AccessTokenPayload {
  sub: number;        // user ID
  username: string;
  email: string;
  twoFactorVerified: boolean; // was 2FA completed this session?
  iat?: number;
  exp?: number;
}

export interface RefreshTokenPayload {
  sub: number;        // user ID
  tokenId: string;   // unique ID to look up the DB record
  iat?: number;
  exp?: number;
}

// ── Access Token ───────────────────────────────────────

export function signAccessToken(payload: Omit<AccessTokenPayload, "iat" | "exp">): string {
    const secret = process.env.JWT_ACCESS_SECRET;

  if (!secret) {
    throw new Error("JWT_ACCESS_SECRET is not set in environment variables");
  }
    
  return jwt.sign(payload, secret, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET!) as AccessTokenPayload;
}

// ── Refresh Token ──────────────────────────────────────

export function signRefreshToken(userId: number): {
  token: string;
  tokenId: string;
  payload: RefreshTokenPayload;
} {
  const tokenId = crypto.randomUUID(); // unique ID stored in DB

  const payload: RefreshTokenPayload = {
    sub: userId,
    tokenId,
  };

  const token = jwt.sign(payload, process.env.JWT_REFRESH_SECRET!, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "7d",
  });

  return { token, tokenId, payload };
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET!) as RefreshTokenPayload;
}

// ── Token Hash ─────────────────────────────────────────
// Never store raw refresh tokens in DB — store the hash

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ── Expiry helper ──────────────────────────────────────

export function getRefreshTokenExpiry(): Date {
  const days = parseInt(process.env.JWT_REFRESH_EXPIRES_IN || "7");
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + days);
  return expiry;
}