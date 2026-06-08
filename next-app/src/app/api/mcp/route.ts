/**
 * MCP Protocol Handler
 *
 * POST /api/mcp — Handle MCP tool calls from AI agents.
 *
 * Authenticates the agent via API key, dispatches the requested tool
 * to the appropriate DAL function, logs the action to AgentAction,
 * and returns the tool result.
 *
 * Supported tools (from .well-known/mcp.json):
 *   - search_products   — search products by keyword/industry/capability
 *   - get_product_detail — get detailed product info
 *   - search_agents     — search AI agents by capability
 *   - search_companies  — search companies and OPC teams
 *   - search_solutions  — search solutions by industry/scenario
 *   - create_demand_draft — create a demand (requires write:demand)
 *   - match_demand      — match a demand to products/agents/companies/solutions
 */

import { authenticateAgent, requireScope } from '@/lib/auth-agent';
import type { AgentAuthResult } from '@/lib/auth-agent';
import prisma from '@/lib/db/client';
import { searchAll } from '@/lib/db/search';
import { getProductById } from '@/lib/db/products';
import { getAgents } from '@/lib/db/agents';
import { getCompanies } from '@/lib/db/companies';
import { getSolutions } from '@/lib/db/solutions';
import {
  getDemands,
  getDemandById,
  createDemand,
  matchDemand,
} from '@/lib/db/demands';
import { createProposal, getProposals } from '@/lib/db/proposals';
import { rateLimit, getClientIdentifier, MCP_LIMIT } from '@/lib/rate-limit';

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

interface ToolDef {
  description: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  scope: string; // minimum required scope
}

const TOOLS: Record<string, ToolDef> = {
  search_products: {
    description: 'Search AI products by keyword, industry, or capability',
    riskLevel: 'low',
    scope: 'read',
  },
  get_product_detail: {
    description: 'Get detailed information about a specific product',
    riskLevel: 'low',
    scope: 'read',
  },
  search_agents: {
    description: 'Search AI agents by capability',
    riskLevel: 'low',
    scope: 'read',
  },
  search_companies: {
    description: 'Search AI companies and OPC teams',
    riskLevel: 'low',
    scope: 'read',
  },
  search_solutions: {
    description: 'Search solutions by industry or scenario',
    riskLevel: 'low',
    scope: 'read',
  },
  create_demand_draft: {
    description: 'Create a demand draft (requires write:demand scope)',
    riskLevel: 'medium',
    scope: 'write:demand',
  },
  list_demands: {
    description: 'List demands with optional filters',
    riskLevel: 'low',
    scope: 'read',
  },
  get_demand_detail: {
    description: 'Get detailed information about a specific demand',
    riskLevel: 'low',
    scope: 'read',
  },
  match_demand: {
    description: 'Match a demand to products, agents, companies, and solutions',
    riskLevel: 'low',
    scope: 'read',
  },
  submit_proposal: {
    description: 'Submit a proposal for a demand (requires write:proposal scope)',
    riskLevel: 'medium',
    scope: 'write:proposal',
  },
  search: {
    description: 'Unified search across products, companies, and solutions',
    riskLevel: 'low',
    scope: 'read',
  },
};

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

async function handleTool(
  tool: string,
  params: Record<string, unknown>,
  auth: AgentAuthResult,
): Promise<unknown> {
  switch (tool) {
    // -- Search tools (read-only) --
    case 'search_products': {
      const q = (params.query ?? params.q ?? '') as string;
      const result = await searchAll(q);
      return { products: result.products };
    }

    case 'get_product_detail': {
      const id = params.id as string;
      if (!id) throw new Error('缺少参数: id');
      const product = await getProductById(id);
      if (!product) throw new Error('产品不存在');
      return product;
    }

    case 'search_agents': {
      const search = (params.query ?? params.q ?? '') as string;
      const agents = await getAgents(
        search ? { search, status: 'published' } : { status: 'published' },
      );
      return { agents };
    }

    case 'search_companies': {
      const search = (params.query ?? params.q ?? '') as string;
      const companies = await getCompanies(search ? { search } : undefined);
      return { companies };
    }

    case 'search_solutions': {
      const search = (params.query ?? params.q ?? '') as string;
      const industry = params.industry as string | undefined;
      const solutions = await getSolutions({
        ...(search ? { search } : {}),
        ...(industry ? { industry } : {}),
      });
      return { solutions };
    }

    case 'search': {
      const q = (params.query ?? params.q ?? '') as string;
      return searchAll(q);
    }

    // -- Demand tools --
    case 'list_demands': {
      const filters: Record<string, string> = {};
      if (params.status) filters.status = params.status as string;
      if (params.industry) filters.industry = params.industry as string;
      if (params.ownerUserId) filters.ownerUserId = params.ownerUserId as string;
      const demands = await getDemands(filters);
      return { demands };
    }

    case 'get_demand_detail': {
      const id = params.id as string;
      if (!id) throw new Error('缺少参数: id');
      const demand = await getDemandById(id);
      if (!demand) throw new Error('需求不存在');
      return demand;
    }

    case 'create_demand_draft': {
      const demand = await createDemand({
        ownerUserId: auth.user.id,
        ownerOrgId: auth.user.orgId ?? undefined,
        title: params.title as string,
        industry: params.industry as string,
        budgetRange: (params.budgetRange ?? '面议') as string,
        budgetMin: params.budgetMin as number | undefined,
        budgetMax: params.budgetMax as number | undefined,
        deliveryPeriod: (params.deliveryPeriod ?? '待定') as string,
        dataTypes: (params.dataTypes ?? []) as string[],
        deploymentRequirement: (params.deploymentRequirement ?? '不限') as string,
        description: (params.description ?? '') as string,
        painPoints: (params.painPoints ?? '') as string,
        existingSystems: (params.existingSystems ?? '') as string,
        supportPoc: (params.supportPoc ?? false) as boolean,
        allowAiSupplier: (params.allowAiSupplier ?? true) as boolean,
        allowAiAutoBid: (params.allowAiAutoBid ?? false) as boolean,
      });
      if (!demand) throw new Error('创建需求失败');
      return demand;
    }

    case 'match_demand': {
      const id = params.demandId as string;
      if (!id) throw new Error('缺少参数: demandId');
      const result = await matchDemand(id);
      if (!result) throw new Error('需求匹配失败，请检查需求ID');
      return result;
    }

    // -- Proposal tools --
    case 'submit_proposal': {
      // supplierOrgId must come from the authenticated user's org — never from params
      if (!auth.user.orgId) {
        throw new Error('提交方案需要供应商组织身份，请确认账户已关联供应商组织');
      }
      const proposal = await createProposal({
        demandId: params.demandId as string,
        supplierOrgId: auth.user.orgId,
        title: params.title as string,
        scope: (params.scope ?? '') as string,
        price: params.price as number,
        currency: (params.currency ?? 'CNY') as string,
        deliveryPeriod: params.deliveryPeriod as string | undefined,
        milestones: params.milestones as
          | {
              name: string;
              description?: string;
              duration: string;
              deliverables?: string[];
            }[]
          | undefined,
        quoteItems: params.quoteItems as
          | {
              name: string;
              description?: string;
              quantity?: number;
              unit?: string;
              unitPrice: number;
              totalPrice: number;
            }[]
          | undefined,
      });
      if (!proposal) throw new Error('提交方案失败');
      return proposal;
    }

    default:
      throw new Error(`未知的工具: ${tool}`);
  }
}

// ---------------------------------------------------------------------------
// Audit logging
// ---------------------------------------------------------------------------

async function logAction(
  auth: AgentAuthResult,
  tool: string,
  params: Record<string, unknown>,
  riskLevel: string,
  decision: string,
  result?: unknown,
  error?: string,
): Promise<void> {
  try {
    await prisma.agentAction.create({
      data: {
        agentId: `mcp:${auth.user.id}`,
        delegatorUserId: auth.user.id,
        organizationId: auth.user.orgId ?? undefined,
        actionType: tool,
        targetType: getTargetType(tool, params),
        targetId: getTargetId(tool, params),
        inputPayload: JSON.stringify(params).slice(0, 4000),
        outputPayload: error
          ? JSON.stringify({ error })
          : JSON.stringify(result).slice(0, 4000),
        riskLevel: riskLevel as 'low' | 'medium' | 'high' | 'critical',
        decision: decision as 'allowed' | 'denied' | 'pending',
        approvalStatus: 'approved',
      },
    });
  } catch (err) {
    console.error('[MCP] Failed to log action:', err);
  }
}

function getTargetType(
  tool: string,
  params: Record<string, unknown>,
): string {
  if (tool.includes('product')) return 'product';
  if (tool.includes('demand') || tool === 'match_demand') return 'demand';
  if (tool.includes('proposal')) return 'proposal';
  if (tool.includes('agent')) return 'agent';
  if (tool.includes('compan')) return 'company';
  if (tool.includes('solution')) return 'solution';
  if (tool === 'search') return 'search';
  return 'unknown';
}

function getTargetId(
  tool: string,
  params: Record<string, unknown>,
): string {
  return (
    (params.id as string) ??
    (params.demandId as string) ??
    (params.productId as string) ??
    ''
  );
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  // Rate limiting
  const clientIp = getClientIdentifier(request);
  const { allowed, retryAfter } = rateLimit(clientIp, MCP_LIMIT);
  if (!allowed) {
    return Response.json(
      { error: '请求过于频繁，请稍后再试' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    );
  }

  // Authenticate the agent
  const auth = await authenticateAgent(request);
  if ('error' in auth) return auth.error;

  // Parse body
  let body: { tool?: string; params?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: '无效的 JSON 请求体' }, { status: 400 });
  }

  const { tool, params = {} } = body;

  if (!tool || typeof tool !== 'string') {
    return Response.json({ error: '缺少 tool 参数' }, { status: 400 });
  }

  // Check tool exists
  const toolDef = TOOLS[tool];
  if (!toolDef) {
    return Response.json(
      { error: `未知的工具: ${tool}`, availableTools: Object.keys(TOOLS) },
      { status: 400 },
    );
  }

  // Check scope
  const scopeCheck = await requireScope(request, toolDef.scope);
  if ('error' in scopeCheck) {
    // Log denied action
    await logAction(auth, tool, params, toolDef.riskLevel, 'denied', undefined, 'Insufficient scope');
    return scopeCheck.error;
  }

  // Execute tool
  try {
    const result = await handleTool(tool, params, auth);

    // Log successful action
    await logAction(auth, tool, params, toolDef.riskLevel, 'allowed', result);

    return Response.json({
      tool,
      result,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '工具执行失败';

    // Log failed action
    await logAction(auth, tool, params, toolDef.riskLevel, 'denied', undefined, message);

    return Response.json({ error: message, tool }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// GET — Tool discovery
// ---------------------------------------------------------------------------

export async function GET() {
  const tools = Object.entries(TOOLS).map(([name, def]) => ({
    name,
    description: def.description,
    riskLevel: def.riskLevel,
    requiredScope: def.scope,
  }));

  return Response.json({
    name: 'iWantU Marketplace MCP',
    version: '0.1.0',
    tools,
  });
}

// ---------------------------------------------------------------------------
// OPTIONS — CORS preflight
// ---------------------------------------------------------------------------

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
