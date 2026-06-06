// ========================================
// iWantU Platform - Shared Type Definitions
// ========================================

// --- Enums ---

export type UserRole =
  | 'guest'
  | 'buyer'
  | 'supplier'
  | 'opc_team'
  | 'operator'
  | 'admin';

export type DemandStatus =
  | 'draft'
  | 'clarifying'
  | 'awaiting_quote'
  | 'collecting_proposals'
  | 'in_poc'
  | 'closed_deal'
  | 'closed';

export type ProductStatus =
  | 'draft'
  | 'pending_review'
  | 'published'
  | 'needs_info'
  | 'delisted'
  | 'flagged';

export type PocStatus =
  | 'not_started'
  | 'confirming_requirements'
  | 'uploading_sample_data'
  | 'supplier_testing'
  | 'result_review'
  | 'procurement_discussion'
  | 'completed'
  | 'terminated';

export type AiActionStatus =
  | 'pending_auth'
  | 'authorized'
  | 'executing'
  | 'needs_confirmation'
  | 'executed'
  | 'rejected'
  | 'revoked'
  | 'intercepted';

export type DeploymentMode = 'saas' | 'private_cloud' | 'on_premise' | 'hybrid';
export type PricingModel = 'subscription' | 'per_project' | 'per_seat' | 'pay_per_use' | 'custom';
export type IndustryTag =
  | 'manufacturing'
  | 'government'
  | 'finance'
  | 'education'
  | 'research'
  | 'healthcare'
  | 'retail'
  | 'energy'
  | 'industrial_software';

// --- Core Domain Types ---

export interface User {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  role: UserRole;
  orgId?: string;
  orgName?: string;
  phone?: string;
  createdAt: string;
}

export interface Organization {
  id: string;
  name: string;
  logo?: string;
  type: 'buyer' | 'supplier' | 'opc_team';
  industry?: IndustryTag;
  description?: string;
  certified: boolean;
  memberCount: number;
}

export interface Product {
  id: string;
  name: string;
  company: string;
  companyLogo?: string;
  summary: string;
  description: string;
  coverImage?: string;
  gallery?: string[];
  category: string;
  industryTags: IndustryTag[];
  capabilityTags: string[];
  deploymentModes: DeploymentMode[];
  pricingModel: PricingModel;
  price: string;
  supportPoc: boolean;
  supportPrivateDeployment: boolean;
  score: string;
  rating: number;
  caseCount: number;
  pocCount: number;
  status: ProductStatus;
  accent: string;
  shot: string;
  tags: string[];
  deploy: string;
  createdAt: string;
}

export interface AgentProduct {
  id: string;
  name: string;
  company: string;
  summary: string;
  description: string;
  taskGoal: string;
  inputSpec: string[];
  outputSpec: string[];
  toolCalls: string[];
  successRate: number;
  deploymentModes: DeploymentMode[];
  pricingModel: PricingModel;
  price: string;
  supportPoc: boolean;
  riskLevel: 'low' | 'medium' | 'high';
  status: ProductStatus;
  tags: string[];
  deploy: string;
  accent: string;
  shot: string;
}

export interface CompanyProfile {
  id: string;
  name: string;
  logo?: string;
  slogan: string;
  description: string;
  certifications: string[];
  capabilities: string[];
  industryExperience: IndustryTag[];
  deliveryScope: string[];
  caseStudies: string[];
  rating: number;
  responseRate: number;
  certified: boolean;
  tags: string[];
}

export interface Demand {
  id: string;
  title: string;
  industry: string;
  budgetRange: string;
  budgetMin?: number;
  budgetMax?: number;
  deliveryPeriod: string;
  dataTypes: string[];
  deploymentRequirement: string;
  description: string;
  painPoints: string;
  existingSystems: string;
  supportPoc: boolean;
  allowAiSupplier: boolean;
  matchScore: string;
  matchScoreNum: number;
  status: DemandStatus;
  ownerUser?: string;
  ownerOrg?: string;
  createdAt: string;
}

export interface Solution {
  id: string;
  title: string;
  summary: string;
  description: string;
  industry: IndustryTag[];
  scenario: string;
  budgetRange: string;
  deploymentModes: DeploymentMode[];
  deliveryPeriod: string;
  supportPoc: boolean;
  components: string[];
  recommendedProducts: string[];
  recommendedCompanies: string[];
}

export interface PocProject {
  id: string;
  demandId: string;
  productId?: string;
  supplierId?: string;
  status: PocStatus;
  testMetrics: string[];
  acceptanceCriteria: string[];
  sampleDataStatus: 'pending' | 'uploaded' | 'processing';
  startDate: string;
  endDate?: string;
  participants: PocParticipant[];
}

export interface PocParticipant {
  userId: string;
  role: 'buyer' | 'supplier' | 'evaluator';
  orgId: string;
}

export interface Proposal {
  id: string;
  demandId: string;
  supplierId: string;
  title: string;
  scope: string;
  price: number;
  currency: string;
  milestones: Milestone[];
  acceptanceCriteria: string[];
  deliveryPeriod: string;
  status: 'draft' | 'submitted' | 'reviewed' | 'accepted' | 'rejected';
  createdAt: string;
}

export interface Milestone {
  name: string;
  description: string;
  duration: string;
  deliverables: string[];
}

export interface QuoteItem {
  name: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
}

export interface MessageThread {
  id: string;
  title: string;
  type: 'demand' | 'poc' | 'proposal' | 'general';
  relatedId?: string;
  participants: string[];
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
}

export interface Message {
  id: string;
  threadId: string;
  senderId: string;
  senderName: string;
  content: string;
  isAiGenerated: boolean;
  timestamp: string;
}

export interface MatchResult {
  demandId: string;
  products: { product: Product; score: number; reason: string }[];
  agents: { agent: AgentProduct; score: number; reason: string }[];
  companies: { company: CompanyProfile; score: number; reason: string }[];
  solutions: { solution: Solution; score: number; reason: string }[];
  riskWarnings: string[];
  nextSteps: string[];
}

export interface AuditLog {
  id: string;
  agentId?: string;
  userId: string;
  action: string;
  targetType: string;
  targetId: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  decision: 'allowed' | 'denied' | 'pending';
  createdAt: string;
}

// --- UI Helper Types ---

export interface NavItem {
  id: string;
  label: string;
  href: string;
}

export interface MetricItem {
  value: string;
  label: string;
}

export interface FilterGroup {
  label: string;
  options: string[];
}

export interface TabItem {
  id: string;
  label: string;
}
