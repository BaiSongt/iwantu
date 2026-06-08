/**
 * Zod Validation Schemas for API Input
 *
 * Centralizes input validation for all API routes and server actions.
 * Each schema validates the request body before it reaches business logic.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Auth schemas
// ---------------------------------------------------------------------------

export const loginSchema = z.object({
  email: z.string().email('请输入有效的邮箱地址'),
  password: z.string().min(1, '请输入密码'),
});

export const registerSchema = z.object({
  name: z
    .string()
    .min(1, '请输入姓名')
    .max(100, '姓名不能超过100个字符'),
  email: z.string().email('请输入有效的邮箱地址'),
  password: z
    .string()
    .min(6, '密码至少需要6个字符')
    .max(128, '密码不能超过128个字符'),
  role: z.enum(['buyer', 'supplier'], {
    message: '请选择有效的角色',
  }),
  orgName: z.string().max(200, '组织名称不能超过200个字符').optional(),
  code: z.string().regex(/^\d{6}$/, '请输入6位数字验证码'),
});

// ---------------------------------------------------------------------------
// Demand schemas
// ---------------------------------------------------------------------------

export const createDemandSchema = z.object({
  title: z
    .string()
    .min(1, '请输入需求标题')
    .max(200, '标题不能超过200个字符'),
  industry: z.string().min(1, '请选择行业'),
  budgetRange: z.string().min(1, '请选择预算范围'),
  budgetMin: z.number().positive().optional(),
  budgetMax: z.number().positive().optional(),
  deliveryPeriod: z.string().min(1, '请选择交付周期'),
  dataTypes: z.array(z.string()).default([]),
  deploymentRequirement: z.string().default(''),
  description: z
    .string()
    .min(10, '需求描述至少需要10个字符')
    .max(5000, '描述不能超过5000个字符'),
  painPoints: z.string().default(''),
  existingSystems: z.string().default(''),
  supportPoc: z.boolean().default(false),
  allowAiSupplier: z.boolean().default(true),
  allowAiAutoBid: z.boolean().default(false),
});

// ---------------------------------------------------------------------------
// Product schemas
// ---------------------------------------------------------------------------

export const createProductSchema = z.object({
  name: z
    .string()
    .min(1, '请输入产品名称')
    .max(200, '产品名称不能超过200个字符'),
  summary: z.string().min(1, '请输入产品摘要').max(500, '摘要不能超过500个字符'),
  description: z.string().default(''),
  coverImage: z.string().url('请输入有效的封面图URL').optional().or(z.literal('')),
  category: z.string().min(1, '请选择产品类别'),
  industryTags: z.array(z.string()).default([]),
  capabilityTags: z.array(z.string()).default([]),
  deploymentModes: z.array(z.string()).default([]),
  pricingModel: z.enum([
    'subscription',
    'per_project',
    'per_seat',
    'pay_per_use',
    'custom',
  ]).default('custom'),
  price: z.string().default(''),
  supportPoc: z.boolean().default(false),
  supportPrivateDeployment: z.boolean().default(false),
  accent: z.string().default('blue'),
  shot: z.string().default('default'),
  tags: z.array(z.string()).default([]),
});

// ---------------------------------------------------------------------------
// Proposal schemas
// ---------------------------------------------------------------------------

export const createProposalSchema = z.object({
  demandId: z.string().min(1, '请选择需求'),
  title: z.string().min(1, '请输入方案标题').max(200, '标题不能超过200个字符'),
  scope: z.string().min(1, '请描述方案范围'),
  price: z.number().positive('价格必须为正数'),
  currency: z.string().default('CNY'),
  deliveryPeriod: z.string().optional(),
  milestones: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        duration: z.string().min(1),
        deliverables: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  quoteItems: z
    .array(
      z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        quantity: z.number().positive().default(1),
        unit: z.string().default('项'),
        unitPrice: z.number().positive(),
        totalPrice: z.number().positive(),
      }),
    )
    .optional(),
});

// ---------------------------------------------------------------------------
// Profile schemas
// ---------------------------------------------------------------------------

export const updateProfileSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  phone: z.string().max(20).optional(),
  avatar: z.string().url().optional().or(z.literal('')),
});

// ---------------------------------------------------------------------------
// Organization schemas
// ---------------------------------------------------------------------------

export const createOrgSchema = z.object({
  name: z
    .string()
    .min(1, '请输入组织名称')
    .max(200, '组织名称不能超过200个字符'),
  type: z.enum(['buyer', 'supplier', 'opc_team'], {
    message: '请选择有效的组织类型',
  }),
  industry: z.string().max(100).optional(),
  description: z.string().max(2000).optional(),
});

// ---------------------------------------------------------------------------
// Upload validation
// ---------------------------------------------------------------------------

export const uploadSchema = z.object({
  targetType: z.enum([
    'product',
    'demand',
    'proposal',
    'poc',
    'message',
  ], {
    message: '无效的目标类型',
  }),
  targetId: z.string().min(1, '缺少 targetId'),
});

// ---------------------------------------------------------------------------
// Helper: format Zod errors into a user-friendly object
// ---------------------------------------------------------------------------

export function formatZodErrors(
  error: z.ZodError,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_root';
    if (!result[key]) {
      result[key] = issue.message;
    }
  }
  return result;
}
