import bcrypt from "bcrypt";

const SALT_ROUNDS = 12;

/**
 * Hash a plaintext password
 */
export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

/**
 * Compare a plaintext password against a stored hash
 */
export async function verifyPassword(
  plaintext: string,  hash: string
): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}