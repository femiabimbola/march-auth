import {
  pgTable, serial,
  varchar,
  text, timestamp,
  boolean,
  integer,
  pgEnum,
  json,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";


// ─────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────

export const userStatusEnum = pgEnum("user_status", [
  "active",
  "inactive",
  "suspended",
  "pending_verification",
]);

// ─────────────────────────────────────────────
// USERS TABLE
// Core identity + credentials + 2FA
// ─────────────────────────────────────────────

export const users = pgTable("users", {
  id: serial("id").primaryKey(),

  // Identity
  username: varchar("username", { length: 50 }).notNull().unique(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 100 }),

  // Credentials
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),

  // Account status
  status: userStatusEnum("status").default("pending_verification").notNull(),
  isEmailVerified: boolean("is_email_verified").default(false).notNull(),
  emailVerificationToken: varchar("email_verification_token", { length: 255 }),
  emailVerificationExpiresAt: timestamp("email_verification_expires_at"),

  // Password reset
  passwordResetToken: varchar("password_reset_token", { length: 255 }),
  passwordResetExpiresAt: timestamp("password_reset_expires_at"),

  // 2FA (TOTP — e.g. Google Authenticator)
  twoFactorEnabled: boolean("two_factor_enabled").default(false).notNull(),
  twoFactorSecret: varchar("two_factor_secret", { length: 255 }), // encrypted TOTP secret
  twoFactorBackupCodes: json("two_factor_backup_codes").$type<string[]>(), // hashed backup codes

  // Security tracking
  failedLoginAttempts: integer("failed_login_attempts").default(0).notNull(),
  lockedUntil: timestamp("locked_until"), // account lockout after too many failures
  lastLoginAt: timestamp("last_login_at"),
  lastLoginIp: varchar("last_login_ip", { length: 45 }), // supports IPv6

  // Timestamps
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});


// ─────────────────────────────────────────────
// REFRESH TOKENS TABLE
// Stored server-side for rotation + revocation
// ─────────────────────────────────────────────

export const refreshTokens = pgTable("refresh_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(),

  // Store the hashed token, never plaintext
  tokenHash: varchar("token_hash", { length: 255 }).notNull().unique(),

  // Device/session info for multi-device support
  userAgent: text("user_agent"),
  ipAddress: varchar("ip_address", { length: 45 }),

  // Token lifecycle
  expiresAt: timestamp("expires_at").notNull(),
  revokedAt: timestamp("revoked_at"), // null = still valid
  replacedByTokenHash: varchar("replaced_by_token_hash", { length: 255 }), // for rotation chain

  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ─────────────────────────────────────────────
// RELATIONS
// ─────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  refreshTokens: many(refreshTokens),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, {
    fields: [refreshTokens.userId],
    references: [users.id],
  }),
}));

// ─────────────────────────────────────────────
// TYPE EXPORTS
// Infer TypeScript types directly from schema
// ─────────────────────────────────────────────

import { InferSelectModel, InferInsertModel } from "drizzle-orm";

export type User = InferSelectModel<typeof users>;
export type NewUser = InferInsertModel<typeof users>;
export type RefreshToken = InferSelectModel<typeof refreshTokens>;
export type NewRefreshToken = InferInsertModel<typeof refreshTokens>;

// Safe user type — never expose sensitive fields to the client
export type SafeUser = Omit<
  User,
  | "passwordHash"
  | "twoFactorSecret"
  | "twoFactorBackupCodes"
  | "emailVerificationToken"
  | "passwordResetToken"
>;