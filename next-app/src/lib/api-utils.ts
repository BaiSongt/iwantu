import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

// 标准化错误响应
export function handleApiError(error: unknown): NextResponse {
  console.error('API Error:', error);

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002': // Unique constraint violation
        return NextResponse.json({ error: '数据已存在' }, { status: 409 });
      case 'P2025': // Record not found
        return NextResponse.json({ error: '资源不存在' }, { status: 404 });
      default:
        return NextResponse.json({ error: '数据库操作失败' }, { status: 500 });
    }
  }

  if (error instanceof Error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ error: '服务器内部错误' }, { status: 500 });
}

// CORS headers helper
export function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

// 成功响应 helper
export function apiSuccess(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: corsHeaders() });
}

// 分页 helper
export function paginateResults(results: unknown[], page: number, pageSize: number) {
  const total = results.length;
  const start = (page - 1) * pageSize;
  const items = results.slice(start, start + pageSize);
  return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}
