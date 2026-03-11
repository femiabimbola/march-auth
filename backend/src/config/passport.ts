import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as JwtStrategy, ExtractJwt } from "passport-jwt";
import { db } from "../database";
import { users } from "../database/schema";
import { eq, or } from "drizzle-orm";
import { verifyPassword } from "../utils/password";
import { AccessTokenPayload } from "../utils/jwt";

// ── Local Strategy ─────────────────────────────────────
// Handles username/email + password login

passport.use(
  "local",
  new LocalStrategy(
    {
      usernameField: "email", // accepts either username or email
      passwordField: "password",
    },
    async (email, password, done) => {
      try {
        // Look up by username OR email
         const [user] = await db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);

        if (!user) {
          // Vague message — don't reveal whether user exists
          return done(null, false, { message: "Invalid credentials" });
        }

        // Check account status
        if (user.status === "suspended") {
          return done(null, false, { message: "Account suspended" });
        }

        // Check if account is locked (brute-force protection)
        if (user.lockedUntil && user.lockedUntil > new Date()) {
          return done(null, false, {
            message: `Account locked. Try again after ${user.lockedUntil.toISOString()}`,
          });
        }

        // Verify password
        const isValid = await verifyPassword(password, user.passwordHash);

        if (!isValid) {
          // Increment failed attempts
          const newAttempts = user.failedLoginAttempts + 1;
          const shouldLock = newAttempts >= 5;

          await db
            .update(users)
            .set({
              failedLoginAttempts: newAttempts,
              // Lock for 15 minutes after 5 failed attempts
              lockedUntil: shouldLock
                ? new Date(Date.now() + 15 * 60 * 1000)
                : null,
              updatedAt: new Date(),
            })
            .where(eq(users.id, user.id));

          return done(null, false, { message: "Invalid credentials" });
        }

        // Reset failed attempts on successful password match
        await db
          .update(users)
          .set({
            failedLoginAttempts: 0,
            lockedUntil: null,
            updatedAt: new Date(),
          })
          .where(eq(users.id, user.id));

        return done(null, user);
      } catch (err) {
        return done(err);
      }
    }
  )
);

// ── JWT Strategy ───────────────────────────────────────
// Validates access tokens on protected routes

passport.use(
  "jwt",
  new JwtStrategy(
    {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: process.env.JWT_ACCESS_SECRET!,
    },
    async (payload: AccessTokenPayload, done) => {
      try {
        const [user] = await db
          .select()
          .from(users)
          .where(eq(users.id, payload.sub))
          .limit(1);

        if (!user || user.status !== "active") {
          return done(null, false);
        }

        // Attach payload info to user for use in route handlers
        return done(null, { ...user, twoFactorVerified: payload.twoFactorVerified });
      } catch (err) {
        return done(err);
      }
    }
  )
);

export default passport;