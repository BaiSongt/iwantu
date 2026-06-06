-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('guest', 'buyer', 'supplier', 'opc_team', 'operator', 'admin');

-- CreateEnum
CREATE TYPE "OrgType" AS ENUM ('buyer', 'supplier', 'opc_team');

-- CreateEnum
CREATE TYPE "DemandStatus" AS ENUM ('draft', 'clarifying', 'awaiting_quote', 'collecting_proposals', 'in_poc', 'closed_deal', 'closed');

-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('draft', 'pending_review', 'published', 'needs_info', 'delisted', 'flagged');

-- CreateEnum
CREATE TYPE "PocStatus" AS ENUM ('not_started', 'confirming_requirements', 'uploading_sample_data', 'supplier_testing', 'result_review', 'procurement_discussion', 'completed', 'terminated');

-- CreateEnum
CREATE TYPE "SampleDataStatus" AS ENUM ('pending', 'uploaded', 'processing');

-- CreateEnum
CREATE TYPE "PricingModel" AS ENUM ('subscription', 'per_project', 'per_seat', 'pay_per_use', 'custom');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "MessageThreadType" AS ENUM ('demand', 'poc', 'proposal', 'general');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('draft', 'submitted', 'reviewed', 'accepted', 'rejected');

-- CreateEnum
CREATE TYPE "AuditDecision" AS ENUM ('allowed', 'denied', 'pending');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "AttachmentTargetType" AS ENUM ('product', 'demand', 'proposal', 'poc', 'message');

-- CreateEnum
CREATE TYPE "ReviewTargetType" AS ENUM ('product', 'agent', 'company');

-- CreateEnum
CREATE TYPE "FeaturedItemType" AS ENUM ('product', 'agent', 'company', 'solution', 'team');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "avatar" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'guest',
    "orgId" TEXT,
    "phone" TEXT,
    "emailVerified" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logo" TEXT,
    "type" "OrgType" NOT NULL,
    "industry" TEXT,
    "description" TEXT,
    "certified" BOOLEAN NOT NULL DEFAULT false,
    "memberCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "coverImage" TEXT,
    "category" TEXT NOT NULL,
    "industryTags" TEXT[],
    "capabilityTags" TEXT[],
    "deploymentModes" TEXT[],
    "pricingModel" "PricingModel" NOT NULL,
    "price" TEXT NOT NULL,
    "supportPoc" BOOLEAN NOT NULL DEFAULT false,
    "supportPrivateDeployment" BOOLEAN NOT NULL DEFAULT false,
    "score" TEXT NOT NULL DEFAULT '',
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "caseCount" INTEGER NOT NULL DEFAULT 0,
    "pocCount" INTEGER NOT NULL DEFAULT 0,
    "status" "ProductStatus" NOT NULL DEFAULT 'draft',
    "accent" TEXT NOT NULL DEFAULT 'blue',
    "shot" TEXT NOT NULL DEFAULT 'default',
    "tags" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_products" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "taskGoal" TEXT NOT NULL DEFAULT '',
    "inputSpec" TEXT[],
    "outputSpec" TEXT[],
    "toolCalls" TEXT[],
    "successRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "deploymentModes" TEXT[],
    "pricingModel" "PricingModel" NOT NULL DEFAULT 'custom',
    "price" TEXT NOT NULL DEFAULT '',
    "supportPoc" BOOLEAN NOT NULL DEFAULT false,
    "riskLevel" "RiskLevel" NOT NULL DEFAULT 'low',
    "status" "ProductStatus" NOT NULL DEFAULT 'draft',
    "tags" TEXT[],
    "deploy" TEXT NOT NULL DEFAULT '',
    "accent" TEXT NOT NULL DEFAULT 'blue',
    "shot" TEXT NOT NULL DEFAULT 'default',

    CONSTRAINT "agent_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_profiles" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "slogan" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "certifications" TEXT[],
    "capabilities" TEXT[],
    "industryExperience" TEXT[],
    "deliveryScope" TEXT[],
    "caseStudies" TEXT[],
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "responseRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "certified" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[],

    CONSTRAINT "company_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demands" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "ownerOrgId" TEXT,
    "title" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "budgetMin" DOUBLE PRECISION,
    "budgetMax" DOUBLE PRECISION,
    "budgetRange" TEXT NOT NULL,
    "deliveryPeriod" TEXT NOT NULL,
    "dataTypes" TEXT[],
    "deploymentRequirement" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "painPoints" TEXT NOT NULL DEFAULT '',
    "existingSystems" TEXT NOT NULL DEFAULT '',
    "supportPoc" BOOLEAN NOT NULL DEFAULT false,
    "allowAiSupplier" BOOLEAN NOT NULL DEFAULT false,
    "allowAiAutoBid" BOOLEAN NOT NULL DEFAULT false,
    "status" "DemandStatus" NOT NULL DEFAULT 'draft',
    "matchScore" TEXT NOT NULL DEFAULT '',
    "matchScoreNum" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solutions" (
    "id" TEXT NOT NULL,
    "orgId" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "industry" TEXT[],
    "scenario" TEXT NOT NULL,
    "budgetRange" TEXT,
    "deploymentModes" TEXT[],
    "deliveryPeriod" TEXT,
    "supportPoc" BOOLEAN NOT NULL DEFAULT true,
    "components" TEXT[],
    "recommendedProductIds" TEXT[],
    "recommendedCompanyIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solutions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poc_projects" (
    "id" TEXT NOT NULL,
    "demandId" TEXT NOT NULL,
    "productId" TEXT,
    "supplierOrgId" TEXT,
    "status" "PocStatus" NOT NULL DEFAULT 'not_started',
    "testMetrics" TEXT[],
    "acceptanceCriteria" TEXT[],
    "sampleDataStatus" "SampleDataStatus" NOT NULL DEFAULT 'pending',
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),

    CONSTRAINT "poc_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "poc_participants" (
    "id" TEXT NOT NULL,
    "pocProjectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,

    CONSTRAINT "poc_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposals" (
    "id" TEXT NOT NULL,
    "demandId" TEXT NOT NULL,
    "supplierOrgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "deliveryPeriod" TEXT,
    "status" "ProposalStatus" NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "milestones" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "duration" TEXT NOT NULL,
    "deliverables" TEXT[],

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_items" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL DEFAULT '项',
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "totalPrice" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "quote_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_threads" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "MessageThreadType" NOT NULL,
    "relatedId" TEXT,
    "lastMessage" TEXT NOT NULL DEFAULT '',
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isAiGenerated" BOOLEAN NOT NULL DEFAULT false,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "thread_participants" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "thread_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "agentId" TEXT,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL,
    "decision" "AuditDecision" NOT NULL,
    "inputPayload" TEXT,
    "outputPayload" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_actions" (
    "id" TEXT NOT NULL,
    "agentId" TEXT,
    "delegatorUserId" TEXT,
    "organizationId" TEXT,
    "actionType" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "inputPayload" TEXT,
    "outputPayload" TEXT,
    "riskLevel" "RiskLevel" NOT NULL DEFAULT 'low',
    "decision" "AuditDecision" NOT NULL DEFAULT 'allowed',
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL,
    "targetType" "AttachmentTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" DOUBLE PRECISION NOT NULL,
    "fileType" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "isSensitive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "targetType" "ReviewTargetType" NOT NULL,
    "targetId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "featured_items" (
    "id" TEXT NOT NULL,
    "itemType" "FeaturedItemType" NOT NULL,
    "itemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "featured_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_orgId_idx" ON "users"("orgId");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "organizations_type_idx" ON "organizations"("type");

-- CreateIndex
CREATE INDEX "organization_members_orgId_idx" ON "organization_members"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_userId_orgId_key" ON "organization_members"("userId", "orgId");

-- CreateIndex
CREATE INDEX "products_orgId_idx" ON "products"("orgId");

-- CreateIndex
CREATE INDEX "products_status_idx" ON "products"("status");

-- CreateIndex
CREATE INDEX "products_category_idx" ON "products"("category");

-- CreateIndex
CREATE INDEX "agent_products_orgId_idx" ON "agent_products"("orgId");

-- CreateIndex
CREATE INDEX "agent_products_status_idx" ON "agent_products"("status");

-- CreateIndex
CREATE UNIQUE INDEX "company_profiles_orgId_key" ON "company_profiles"("orgId");

-- CreateIndex
CREATE INDEX "demands_ownerUserId_idx" ON "demands"("ownerUserId");

-- CreateIndex
CREATE INDEX "demands_ownerOrgId_idx" ON "demands"("ownerOrgId");

-- CreateIndex
CREATE INDEX "demands_status_idx" ON "demands"("status");

-- CreateIndex
CREATE INDEX "demands_industry_idx" ON "demands"("industry");

-- CreateIndex
CREATE INDEX "solutions_orgId_idx" ON "solutions"("orgId");

-- CreateIndex
CREATE INDEX "poc_projects_demandId_idx" ON "poc_projects"("demandId");

-- CreateIndex
CREATE INDEX "poc_projects_status_idx" ON "poc_projects"("status");

-- CreateIndex
CREATE INDEX "poc_participants_pocProjectId_idx" ON "poc_participants"("pocProjectId");

-- CreateIndex
CREATE INDEX "poc_participants_userId_idx" ON "poc_participants"("userId");

-- CreateIndex
CREATE INDEX "proposals_demandId_idx" ON "proposals"("demandId");

-- CreateIndex
CREATE INDEX "proposals_supplierOrgId_idx" ON "proposals"("supplierOrgId");

-- CreateIndex
CREATE INDEX "proposals_status_idx" ON "proposals"("status");

-- CreateIndex
CREATE INDEX "milestones_proposalId_idx" ON "milestones"("proposalId");

-- CreateIndex
CREATE INDEX "quote_items_proposalId_idx" ON "quote_items"("proposalId");

-- CreateIndex
CREATE INDEX "message_threads_type_idx" ON "message_threads"("type");

-- CreateIndex
CREATE INDEX "message_threads_relatedId_idx" ON "message_threads"("relatedId");

-- CreateIndex
CREATE INDEX "messages_threadId_idx" ON "messages"("threadId");

-- CreateIndex
CREATE INDEX "messages_senderId_idx" ON "messages"("senderId");

-- CreateIndex
CREATE INDEX "thread_participants_userId_idx" ON "thread_participants"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "thread_participants_threadId_userId_key" ON "thread_participants"("threadId", "userId");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_agentId_idx" ON "audit_logs"("agentId");

-- CreateIndex
CREATE INDEX "audit_logs_targetType_targetId_idx" ON "audit_logs"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "agent_actions_agentId_idx" ON "agent_actions"("agentId");

-- CreateIndex
CREATE INDEX "agent_actions_organizationId_idx" ON "agent_actions"("organizationId");

-- CreateIndex
CREATE INDEX "agent_actions_targetType_targetId_idx" ON "agent_actions"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "attachments_targetType_targetId_idx" ON "attachments"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "reviews_targetType_targetId_idx" ON "reviews"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "reviews_userId_idx" ON "reviews"("userId");

-- CreateIndex
CREATE INDEX "featured_items_itemType_idx" ON "featured_items"("itemType");

-- CreateIndex
CREATE INDEX "featured_items_active_idx" ON "featured_items"("active");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_products" ADD CONSTRAINT "agent_products_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_profiles" ADD CONSTRAINT "company_profiles_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demands" ADD CONSTRAINT "demands_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solutions" ADD CONSTRAINT "solutions_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poc_projects" ADD CONSTRAINT "poc_projects_demandId_fkey" FOREIGN KEY ("demandId") REFERENCES "demands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "poc_participants" ADD CONSTRAINT "poc_participants_pocProjectId_fkey" FOREIGN KEY ("pocProjectId") REFERENCES "poc_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_demandId_fkey" FOREIGN KEY ("demandId") REFERENCES "demands"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "milestones" ADD CONSTRAINT "milestones_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "message_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_participants" ADD CONSTRAINT "thread_participants_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "message_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "thread_participants" ADD CONSTRAINT "thread_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_delegatorUserId_fkey" FOREIGN KEY ("delegatorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
