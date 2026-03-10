import speakeasy from "speakeasy";
import qrcode from "qrcode";
import CryptoJS from "crypto-js";
import crypto from "crypto";

const ENCRYPTION_KEY = process.env.TWO_FACTOR_ENCRYPTION_KEY!;

// ── Secret Generation ──────────────────────────────────

/**
 * Generate a new TOTP secret for a user.
 * Returns the raw secret (for QR) and the encrypted secret (for DB storage).
 */
export function generateTwoFactorSecret(username: string): {
  secret: string;          // raw — used to generate QR, discard after setup
  encryptedSecret: string; // store this in DB
  otpauthUrl: string;      // used to generate QR code
} {
  const secretObj = speakeasy.generateSecret({
    name: `${process.env.APP_NAME}:${username}`,
    length: 20,
  });

  const encryptedSecret = CryptoJS.AES.encrypt(
    secretObj.base32,
    ENCRYPTION_KEY
  ).toString();

  return {
    secret: secretObj.base32,
    encryptedSecret,
    otpauthUrl: secretObj.otpauth_url!,
  };
}

// ── QR Code ────────────────────────────────────────────

/**
 * Generate a QR code data URL from the otpauth URL.
 * Render this as an <img> in your frontend during 2FA setup.
 */
export async function generateQRCode(otpauthUrl: string): Promise<string> {
  return qrcode.toDataURL(otpauthUrl);
}

// ── Token Verification ─────────────────────────────────

/**
 * Verify a TOTP token from the user's authenticator app.
 * Decrypts the stored secret before verifying.
 */
export function verifyTwoFactorToken(
  encryptedSecret: string,
  token: string
): boolean {
  const decryptedBytes = CryptoJS.AES.decrypt(encryptedSecret, ENCRYPTION_KEY);
  const secret = decryptedBytes.toString(CryptoJS.enc.Utf8);

  return speakeasy.totp.verify({
    secret,
    encoding: "base32",
    token,
    window: 1, // allow 1 step drift (30s before/after)
  });
}

// ── Backup Codes ───────────────────────────────────────

/**
 * Generate 8 one-time backup codes.
 * Returns plaintext codes (show to user once) and hashed codes (store in DB).
 */
export function generateBackupCodes(): {
  plainCodes: string[];
  hashedCodes: string[];
} {
  const plainCodes = Array.from({ length: 8 }, () =>
    crypto.randomBytes(4).toString("hex").toUpperCase() // e.g. "A1B2C3D4"
  );

  const hashedCodes = plainCodes.map((code) =>
    crypto.createHash("sha256").update(code).digest("hex")
  );

  return { plainCodes, hashedCodes };
}

/**
 * Verify and consume a backup code.
 * Returns the remaining codes after removal (update DB with these).
 */
export function verifyAndConsumeBackupCode(
  inputCode: string,
  hashedCodes: string[]
): { valid: boolean; remainingCodes: string[] } {
  const inputHash = crypto
    .createHash("sha256")
    .update(inputCode.toUpperCase())
    .digest("hex");

  const index = hashedCodes.indexOf(inputHash);

  if (index === -1) {
    return { valid: false, remainingCodes: hashedCodes };
  }

  // Remove the used code
  const remainingCodes = hashedCodes.filter((_, i) => i !== index);
  return { valid: true, remainingCodes };
}