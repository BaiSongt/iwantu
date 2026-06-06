import type { Product, CompanyProfile, Demand, Solution } from '@/types';

export function productToMarkdown(product: Product): string {
  const lines: string[] = [
    `# ${product.name}`,
    '',
    `**Company:** ${product.company}`,
    `**Category:** ${product.category}`,
    `**Rating:** ${product.rating}/5 (${product.caseCount} cases, ${product.pocCount} POCs)`,
    '',
    `## Summary`,
    '',
    product.summary,
    '',
    `## Details`,
    '',
    '| Property | Value |',
    '|---|---|',
    `| Price | ${product.price} |`,
    `| Pricing Model | ${product.pricingModel} |`,
    `| Deployment | ${product.deploy} |`,
    `| Private Deployment | ${product.supportPrivateDeployment ? 'Yes' : 'No'} |`,
    `| POC Support | ${product.supportPoc ? 'Yes' : 'No'} |`,
    `| Score | ${product.score} |`,
    `| Status | ${product.status} |`,
    `| Created | ${product.createdAt} |`,
    '',
    `## Industries`,
    '',
    ...product.industryTags.map((tag) => `- ${tag}`),
    '',
    `## Capabilities`,
    '',
    ...product.capabilityTags.map((tag) => `- ${tag}`),
    '',
    `## Tags`,
    '',
    product.tags.join(', '),
    '',
  ];

  return lines.join('\n');
}

export function companyToMarkdown(company: CompanyProfile): string {
  const lines: string[] = [
    `# ${company.name}`,
    '',
    `> ${company.slogan}`,
    '',
    company.description,
    '',
    `## Overview`,
    '',
    '| Property | Value |',
    '|---|---|',
    `| Rating | ${company.rating}/5 |`,
    `| Response Rate | ${company.responseRate}% |`,
    `| Certified | ${company.certified ? 'Yes' : 'No'} |`,
    '',
    `## Certifications`,
    '',
    ...company.certifications.map((c) => `- ${c}`),
    '',
    `## Capabilities`,
    '',
    ...company.capabilities.map((c) => `- ${c}`),
    '',
    `## Industry Experience`,
    '',
    ...company.industryExperience.map((i) => `- ${i}`),
    '',
    `## Delivery Scope`,
    '',
    ...company.deliveryScope.map((d) => `- ${d}`),
    '',
    `## Case Studies`,
    '',
    ...company.caseStudies.map((c) => `- ${c}`),
    '',
    `## Tags`,
    '',
    company.tags.join(', '),
    '',
  ];

  return lines.join('\n');
}

export function demandToMarkdown(demand: Demand): string {
  const lines: string[] = [
    `# ${demand.title}`,
    '',
    `## Overview`,
    '',
    '| Property | Value |',
    '|---|---|',
    `| Industry | ${demand.industry} |`,
    `| Budget | ${demand.budgetRange} |`,
    `| Delivery Period | ${demand.deliveryPeriod} |`,
    `| Deployment | ${demand.deploymentRequirement} |`,
    `| Status | ${demand.status} |`,
    `| Match Score | ${demand.matchScore} |`,
    `| POC Support | ${demand.supportPoc ? 'Yes' : 'No'} |`,
    `| Allow AI Supplier | ${demand.allowAiSupplier ? 'Yes' : 'No'} |`,
    `| Created | ${demand.createdAt} |`,
    '',
  ];

  if (demand.description) {
    lines.push('## Description', '', demand.description, '');
  }

  if (demand.painPoints) {
    lines.push('## Pain Points', '', demand.painPoints, '');
  }

  if (demand.existingSystems) {
    lines.push('## Existing Systems', '', demand.existingSystems, '');
  }

  if (demand.dataTypes.length > 0) {
    lines.push('## Data Types', '', ...demand.dataTypes.map((d) => `- ${d}`), '');
  }

  return lines.join('\n');
}

export function solutionToMarkdown(solution: Solution): string {
  const lines: string[] = [
    `# ${solution.title}`,
    '',
    solution.summary,
    '',
    `## Overview`,
    '',
    '| Property | Value |',
    '|---|---|',
    `| Scenario | ${solution.scenario} |`,
    `| Budget Range | ${solution.budgetRange} |`,
    `| Delivery Period | ${solution.deliveryPeriod} |`,
    `| POC Support | ${solution.supportPoc ? 'Yes' : 'No'} |`,
    '',
    `## Industries`,
    '',
    ...solution.industry.map((i) => `- ${i}`),
    '',
    `## Deployment Modes`,
    '',
    ...solution.deploymentModes.map((d) => `- ${d}`),
    '',
    `## Components`,
    '',
    ...solution.components.map((c) => `- ${c}`),
    '',
    `## Recommended Products`,
    '',
    ...solution.recommendedProducts.map((p) => `- ${p}`),
    '',
    `## Recommended Companies`,
    '',
    ...solution.recommendedCompanies.map((c) => `- ${c}`),
    '',
  ];

  if (solution.description) {
    lines.push('## Details', '', solution.description, '');
  }

  return lines.join('\n');
}
