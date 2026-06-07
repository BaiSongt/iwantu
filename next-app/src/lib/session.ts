'use server';

import { cookies } from 'next/headers';
import { signToken, verifyToken, hashPassword, comparePassword } from '@/lib/auth';
import prisma from '@/lib/db/client';
import type { User, UserRole } from '@/types';
import { loginSchema, registerSchema, formatZodErrors } from '@/lib/validations';
import { rateLimit } from '@/lib/rate-limit';

// ---- Session helpers ----

const SESSION_COOKIE = 'iwantu_session';

async function createSessionCookie(payload: {
  userId: string;
  email: string;
  name: string;
  role: string;
  orgId?: string;
}): Promise<void> {
  const token = await signToken(payload);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    expires: expiresAt,
    sameSite: 'lax',
    path: '/',
  });
}

async function clearSessionCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

// ---- Server actions ----

export async function loginAction(
  email: string,
  password: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Input validation
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const errors = formatZodErrors(parsed.error);
      return { success: false, error: Object.values(errors)[0] || '输入验证失败' };
    }

    // Rate limiting — use email as identifier for server actions
    const { allowed } = rateLimit(email, { limit: 10, windowMs: 60_000 });
    if (!allowed) {
      return { success: false, error: '登录尝试过于频繁，请稍后再试' };
    }

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (!user) {
      return { success: false, error: '邮箱或密码错误' };
    }

    const valid = await comparePassword(password, user.passwordHash);
    if (!valid) {
      return { success: false, error: '邮箱或密码错误' };
    }

    await createSessionCookie({
      userId: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      orgId: user.orgId ?? undefined,
    });

    return { success: true };
  } catch {
    return { success: false, error: '登录失败，请稍后重试' };
  }
}

export async function registerAction(
  name: string,
  email: string,
  password: string,
  role: string,
  orgName?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Input validation with Zod
    const parsed = registerSchema.safeParse({ name, email, password, role, orgName });
    if (!parsed.success) {
      const errors = formatZodErrors(parsed.error);
      return { success: false, error: Object.values(errors)[0] || '输入验证失败' };
    }

    const validated = parsed.data;

    // Rate limiting — use email as identifier
    const { allowed } = rateLimit(email, { limit: 5, windowMs: 60_000 });
    if (!allowed) {
      return { success: false, error: '注册尝试过于频繁，请稍后再试' };
    }

    const existing = await prisma.user.findUnique({ where: { email: validated.email } });
    if (existing) {
      return { success: false, error: '该邮箱已被注册' };
    }

    const passwordHash = await hashPassword(validated.password);

    // Determine org type from user role
    const orgType = validated.role === 'buyer' ? 'buyer' : validated.role === 'supplier' ? 'supplier' : 'opc_team';

    // Use transaction when orgName is provided to ensure atomicity
    if (validated.orgName && validated.orgName.trim()) {
      const result = await prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            name: validated.name,
            email: validated.email,
            passwordHash,
            role: validated.role as UserRole,
          },
        });

        const org = await tx.organization.create({
          data: {
            name: validated.orgName!.trim(),
            type: orgType,
          },
        });

        await tx.organizationMember.create({
          data: {
            userId: newUser.id,
            orgId: org.id,
            role: 'owner',
          },
        });

        const updatedUser = await tx.user.update({
          where: { id: newUser.id },
          data: { orgId: org.id },
        });

        return { user: updatedUser, orgId: org.id };
      });

      await createSessionCookie({
        userId: result.user.id,
        email: result.user.email,
        name: result.user.name,
        role: result.user.role,
        orgId: result.orgId,
      });
    } else {
      const newUser = await prisma.user.create({
        data: {
          name: validated.name,
          email: validated.email,
          passwordHash,
          role: validated.role as UserRole,
        },
      });

      await createSessionCookie({
        userId: newUser.id,
        email: newUser.email,
        name: newUser.name,
        role: newUser.role,
        orgId: newUser.orgId ?? undefined,
      });
    }

    return { success: true };
  } catch {
    return { success: false, error: '注册失败，请稍后重试' };
  }
}

export async function logoutAction(): Promise<void> {
  await clearSessionCookie();
}

export async function getCurrentUser(): Promise<User | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(SESSION_COOKIE)?.value;

    if (!token) {
      return null;
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return null;
    }

    const userId = payload.userId as string;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return null;
    }

    // Exclude passwordHash before returning to the frontend
    const { passwordHash: _ph, ...safeUser } = user;
    return {
      id: safeUser.id,
      name: safeUser.name,
      email: safeUser.email,
      avatar: safeUser.avatar ?? undefined,
      role: safeUser.role as UserRole,
      orgId: safeUser.orgId ?? undefined,
      createdAt: safeUser.createdAt.toISOString(),
    };
  } catch {
    return null;
  }
}
