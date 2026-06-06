import type { Product, CompanyProfile, Demand, Solution } from '@/types';

export function generateProductJsonLd(product: Product): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.summary,
    image: product.coverImage,
    brand: {
      '@type': 'Organization',
      name: product.company,
      logo: product.companyLogo,
    },
    category: product.category,
    offers: {
      '@type': 'Offer',
      price: product.price,
      priceCurrency: 'CNY',
      availability: 'https://schema.org/InStock',
      seller: {
        '@type': 'Organization',
        name: product.company,
      },
    },
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: product.rating,
      bestRating: 5,
      reviewCount: product.caseCount,
    },
    potentialAction: [
      {
        '@type': 'AskAction',
        name: 'Contact Supplier',
        target: `https://iwantu.ai/products/${product.id}`,
      },
      ...(product.supportPoc
        ? [
            {
              '@type': 'AssessAction',
              name: 'Request POC',
              target: `https://iwantu.ai/products/${product.id}#poc`,
            },
          ]
        : []),
    ],
    additionalProperty: [
      {
        '@type': 'PropertyValue',
        name: 'industryTags',
        value: product.industryTags.join(', '),
      },
      {
        '@type': 'PropertyValue',
        name: 'capabilityTags',
        value: product.capabilityTags.join(', '),
      },
      {
        '@type': 'PropertyValue',
        name: 'deploymentModes',
        value: product.deploymentModes.join(', '),
      },
      {
        '@type': 'PropertyValue',
        name: 'pricingModel',
        value: product.pricingModel,
      },
      {
        '@type': 'PropertyValue',
        name: 'supportPrivateDeployment',
        value: product.supportPrivateDeployment,
      },
    ],
  };
}

export function generateCompanyJsonLd(company: CompanyProfile): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: company.name,
    description: company.description,
    logo: company.logo,
    slogan: company.slogan,
    certifications: company.certifications,
    knowsAbout: company.capabilities,
    aggregateRating: {
      '@type': 'AggregateRating',
      ratingValue: company.rating,
      bestRating: 5,
    },
    additionalProperty: [
      {
        '@type': 'PropertyValue',
        name: 'industryExperience',
        value: company.industryExperience.join(', '),
      },
      {
        '@type': 'PropertyValue',
        name: 'deliveryScope',
        value: company.deliveryScope.join(', '),
      },
      {
        '@type': 'PropertyValue',
        name: 'responseRate',
        value: company.responseRate,
      },
      {
        '@type': 'PropertyValue',
        name: 'certified',
        value: company.certified,
      },
    ],
  };
}

export function generateDemandJsonLd(demand: Demand): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'Demand',
    name: demand.title,
    description: demand.description,
    industry: demand.industry,
    budgetRange: demand.budgetRange,
    deliveryPeriod: demand.deliveryPeriod,
    status: demand.status,
    additionalProperty: [
      {
        '@type': 'PropertyValue',
        name: 'dataTypes',
        value: demand.dataTypes.join(', '),
      },
      {
        '@type': 'PropertyValue',
        name: 'deploymentRequirement',
        value: demand.deploymentRequirement,
      },
      {
        '@type': 'PropertyValue',
        name: 'supportPoc',
        value: demand.supportPoc,
      },
      {
        '@type': 'PropertyValue',
        name: 'allowAiSupplier',
        value: demand.allowAiSupplier,
      },
      {
        '@type': 'PropertyValue',
        name: 'matchScore',
        value: demand.matchScore,
      },
    ],
  };
}

export function generateSolutionJsonLd(solution: Solution): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'CreativeWork',
    name: solution.title,
    description: solution.summary,
    genre: solution.scenario,
    additionalProperty: [
      {
        '@type': 'PropertyValue',
        name: 'industry',
        value: solution.industry.join(', '),
      },
      {
        '@type': 'PropertyValue',
        name: 'budgetRange',
        value: solution.budgetRange,
      },
      {
        '@type': 'PropertyValue',
        name: 'deploymentModes',
        value: solution.deploymentModes.join(', '),
      },
      {
        '@type': 'PropertyValue',
        name: 'deliveryPeriod',
        value: solution.deliveryPeriod,
      },
      {
        '@type': 'PropertyValue',
        name: 'supportPoc',
        value: solution.supportPoc,
      },
      {
        '@type': 'PropertyValue',
        name: 'components',
        value: solution.components.join(', '),
      },
      {
        '@type': 'PropertyValue',
        name: 'recommendedProducts',
        value: solution.recommendedProducts.join(', '),
      },
      {
        '@type': 'PropertyValue',
        name: 'recommendedCompanies',
        value: solution.recommendedCompanies.join(', '),
      },
    ],
  };
}

export function generateWebsiteJsonLd(): object {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'iWantU',
    url: 'https://iwantu.ai/',
    description: 'AI capability marketplace for humans and autonomous AI agents.',
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: 'https://iwantu.ai/api/search?q={search_term_string}',
      },
      'query-input': 'required name=search_term_string',
    },
  };
}
