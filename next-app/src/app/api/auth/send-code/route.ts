/**
 * POST /api/auth/send-code
 *
 * Send a 6-digit verification code to the given email address.
 * Used during registration to verify email ownership.
 *
 * Rate limiting: 1 request per email per 60 seconds.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { rateLimit, getClientIdentifier } from '@/lib/rate-limit';
import { createEmailVerificationCode } from '@/lib/email-verification';
import { sendVerificationCodeEmail } from '@/lib/email';
import prisma from '@/lib/db/client';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const sendCodeSchema = z.object({
  email: z.string().email('请输入有效的邮箱地址'),
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = sendCodeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: '请输入有效的邮箱地址' },
        { status: 400 },
      );
    }

    const { email } = parsed.data;
    const normalisedEmail = email.trim().toLowerCase();

    // Rate limit per email: 1 request per 60 seconds
    const { allowed } = rateLimit(`send-code:${normalisedEmail}`, {
      limit: 1,
      windowMs: 60_000,
    });
    if (!allowed) {
      return NextResponse.json(
        { success: false, error: '发送太频繁，请60秒后重试' },
        { status: 429 },
      );
    }

    // Also rate-limit by client IP to prevent abuse
    const clientId = getClientIdentifier(request);
    const ipLimit = rateLimit(`send-code-ip:${clientId}`, {
      limit: 5,
      windowMs: 60_000,
    });
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { success: false, error: '请求过于频繁，请稍后再试' },
        { status: 429 },
      );
    }

    // Check if email is already registered
    const existing = await prisma.user.findUnique({
      where: { email: normalisedEmail },
    });
    if (existing) {
      return NextResponse.json(
        { success: false, error: '该邮箱已被注册' },
        { status: 409 },
      );
    }

    // Create verification code
    const code = await createEmailVerificationCode(normalisedEmail);

    // Send email
    const sent = await sendVerificationCodeEmail(normalisedEmail, code);
    if (!sent) {
      return NextResponse.json(
        { success: false, error: '验证码发送失败，请稍后重试' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json(
      { success: false, error: '发送失败，请稍后重试' },
      { status: 500 },
    );
  }
}
