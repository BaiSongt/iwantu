'use server';

import { cookies } from 'next/headers';
import { signToken, verifyToken, hashPassword, comparePassword } from '@/lib/auth';
import prisma from '@/lib/db/client';
import type { User, UserRole } from '@/types';

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
    if (!email || !password) {
      return { success: false, error: '请输入邮箱和密码' };
    }

    const user = await prisma.user.findUnique({ where: { email } });
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
    if (!name || !email || !password || !role) {
      return { success: false, error: '请填写所有必填字段' };
    }

    if (password.length < 6) {
      return { success: false, error: '密码至少需要6个字符' };
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return { success: false, error: '该邮箱已被注册' };
    }

    const validRoles: UserRole[] = ['buyer', 'supplier', 'opc_team'];
    if (!validRoles.includes(role as UserRole)) {
      return { success: false, error: '请选择有效的角色' };
    }

    const passwordHash = await hashPassword(password);

    // Determine org type from user role
    const orgType = role === 'buyer' ? 'buyer' : role === 'supplier' ? 'supplier' : 'opc_team';

    // Use transaction when orgName is provided to ensure atomicity
    if (orgName && orgName.trim()) {
      const result = await prisma.$transaction(async (tx) => {
        const newUser = await tx.user.create({
          data: {
            name,
            email,
            passwordHash,
            role: role as UserRole,
          },
        });

        const org = await tx.organization.create({
          data: {
            name: orgName.trim(),
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
          name,
          email,
          passwordHash,
          role: role as UserRole,
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
