/**
 * Email Verification Code Utilities
 *
 * Provides generation, hashing, creation, and verification of 6-digit
 * email verification codes for the registration flow.
 *
 * Security considerations:
 * - Codes are hashed before storage (never stored in plaintext).
 * - Each code expires after 10 minutes.
 * - A maximum of 5 verification attempts per code.
 * - Codes are single-use (consumedAt set on success).
 */

import crypto from 'crypto';
import prisma from '@/lib/db/client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a cryptographically random 6-digit verification code.
 */
export function generateVerificationCode(): string {
  // Generate a random number between 100000 and 999999 inclusive
  const code = crypto.randomInt(100000, 1000000);
  return code.toString();
}

/**
 * Hash a verification code together with the email using HMAC-SHA256.
 *
 * The email is normalised (trimmed + lowercased) before hashing so that
 * case or whitespace variations do not cause mismatches.
 */
export function hashVerificationCode(email: string, code: string): string {
  const normalisedEmail = email.trim().toLowerCase();
  const secret = process.env.JWT_SECRET || 'dev-secret';
  return crypto
    .createHmac('sha256', secret)
    .update(`${normalisedEmail}:${code}`)
    .digest('hex');
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Create a new email verification code for registration.
 *
 * Any existing unconsumed codes for the same email + purpose are left as-is;
 * only the latest code will be considered during verification.
 *
 * @returns The plaintext code (to be sent via email).
 */
export async function createEmailVerificationCode(
  email: string,
): Promise<string> {
  const normalisedEmail = email.trim().toLowerCase();
  const code = generateVerificationCode();
  const codeHash = hashVerificationCode(normalisedEmail, code);

  await prisma.emailVerificationCode.create({
    data: {
      email: normalisedEmail,
      codeHash,
      purpose: 'register',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    },
  });

  return code;
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 5;

interface VerifyResult {
  success: boolean;
  error?: string;
}

/**
 * Verify a user-supplied code against the latest valid record.
 *
 * Rules:
 * - Looks up the latest unconsumed, unexpired code for the email.
 * - If not found → "验证码不存在或已过期".
 * - If attempts >= 5 → "验证码错误次数过多，请重新获取".
 * - If hash mismatch → increment attempts, return "验证码错误".
 * - If hash match → set consumedAt, return success.
 */
export async function verifyEmailCode(
  email: string,
  code: string,
): Promise<VerifyResult> {
  const normalisedEmail = email.trim().toLowerCase();

  const record = await prisma.emailVerificationCode.findFirst({
    where: {
      email: normalisedEmail,
      purpose: 'register',
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!record) {
    return { success: false, error: '验证码不存在或已过期' };
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    return { success: false, error: '验证码错误次数过多，请重新获取' };
  }

  const inputHash = hashVerificationCode(normalisedEmail, code);

  if (inputHash !== record.codeHash) {
    await prisma.emailVerificationCode.update({
      where: { id: record.id },
      data: { attempts: record.attempts + 1 },
    });
    return { success: false, error: '验证码错误' };
  }

  // Mark as consumed
  await prisma.emailVerificationCode.update({
    where: { id: record.id },
    data: { consumedAt: new Date() },
  });

  return { success: true };
}
