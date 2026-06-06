/**
 * Agents (AgentProduct) Data Access Layer
 *
 * Handles all database operations for AI agent products.
 * Maps the Prisma AgentProduct model to the frontend AgentProduct type.
 * Includes the associated Organization to populate the `company` field.
 */

import prisma from './client';
import type { AgentProduct } from '@/types';

/**
 * Fetch a list of agent products with optional filters.
 *
 * @param filters - Optional filters: status, riskLevel, search
 * @returns Array of AgentProduct objects
 */
export async function getAgents(filters?: {
  status?: string;
  riskLevel?: string;
  search?: string;
}): Promise<AgentProduct[]> {
  try {
    const where: Record<string, unknown> = {};

    if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.riskLevel) {
      where.riskLevel = filters.riskLevel;
    }

    if (filters?.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { summary: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
        { taskGoal: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const rows = await prisma.agentProduct.findMany({
      where,
      include: { organization: true },
      orderBy: { id: 'desc' },
    });

    return rows.map(mapAgentRow);
  } catch (error) {
    console.error('[DAL] getAgents failed:', error);
    return [];
  }
}

/**
 * Fetch a single agent product by ID.
 *
 * @param id - AgentProduct ID (cuid)
 * @returns AgentProduct object or null if not found
 */
export async function getAgentById(id: string): Promise<AgentProduct | null> {
  try {
    const row = await prisma.agentProduct.findUnique({
      where: { id },
      include: { organization: true },
    });

    if (!row) return null;
    return mapAgentRow(row);
  } catch (error) {
    console.error('[DAL] getAgentById failed:', error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internal mapper: Prisma row -> frontend AgentProduct
// ---------------------------------------------------------------------------

function mapAgentRow(row: {
  id: string;
  name: string;
  summary: string;
  description: string;
  taskGoal: string;
  inputSpec: string[];
  outputSpec: string[];
  toolCalls: string[];
  successRate: number;
  deploymentModes: string[];
  pricingModel: string;
  price: string;
  supportPoc: boolean;
  riskLevel: string;
  status: string;
  tags: string[];
  deploy: string;
  accent: string;
  shot: string;
  organization: { id: string; name: string; logo: string | null } | null;
}): AgentProduct {
  return {
    id: row.id,
    name: row.name,
    company: row.organization?.name ?? '',
    summary: row.summary,
    description: row.description,
    taskGoal: row.taskGoal,
    inputSpec: row.inputSpec,
    outputSpec: row.outputSpec,
    toolCalls: row.toolCalls,
    successRate: row.successRate,
    deploymentModes: row.deploymentModes as AgentProduct['deploymentModes'],
    pricingModel: row.pricingModel as AgentProduct['pricingModel'],
    price: row.price,
    supportPoc: row.supportPoc,
    riskLevel: row.riskLevel as AgentProduct['riskLevel'],
    status: row.status as AgentProduct['status'],
    tags: row.tags,
    deploy: row.deploy,
    accent: row.accent,
    shot: row.shot,
  };
}
