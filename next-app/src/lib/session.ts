'use server';

import { cookies } from 'next/headers';
import { signToken, verifyToken, hashPassword, comparePassword } from '@/lib/auth';
import type { User, UserRole } from '@/types';

// ---- In-memory user store (replace with database in production) ----
interface StoredUser {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  orgId?: string;
  avatar?: string;
  createdAt: string;
}

const users: StoredUser[] = [];

function findUserByEmail(email: string): StoredUser | undefined {
  return users.find((u) => u.email === email);
}

function generateId(): string {
  return `user_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

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

    const user = findUserByEmail(email);
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
      orgId: user.orgId,
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
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!name || !email || !password || !role) {
      return { success: false, error: '请填写所有必填字段' };
    }

    if (password.length < 6) {
      return { success: false, error: '密码至少需要6个字符' };
    }

    const existing = findUserByEmail(email);
    if (existing) {
      return { success: false, error: '该邮箱已被注册' };
    }

    const validRoles: UserRole[] = ['buyer', 'supplier', 'opc_team'];
    if (!validRoles.includes(role as UserRole)) {
      return { success: false, error: '请选择有效的角色' };
    }

    const passwordHash = await hashPassword(password);
    const newUser: StoredUser = {
      id: generateId(),
      name,
      email,
      passwordHash,
      role: role as UserRole,
      createdAt: new Date().toISOString(),
    };

    users.push(newUser);

    await createSessionCookie({
      userId: newUser.id,
      email: newUser.email,
      name: newUser.name,
      role: newUser.role,
      orgId: newUser.orgId,
    });

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
    const user = users.find((u) => u.id === userId);
    if (!user) {
      return null;
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      avatar: user.avatar,
      role: user.role,
      orgId: user.orgId,
      createdAt: user.createdAt,
    };
  } catch {
    return null;
  }
}
