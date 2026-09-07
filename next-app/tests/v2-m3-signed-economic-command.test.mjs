import assert from 'node:assert/strict';
import {
  generateKeyPairSync,
  sign as signDigest,
  createHash,
} from 'node:crypto';
import test, { after, before } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { createAgentApiCredentialMaterial } from '../src/lib/agent-auth-core.mjs';
import { createV2AgentAuthenticationContext } from '../src/lib/agent-auth-context-core.mjs';
import {
  buildFirmOfferHash,
} from '../src/lib/offer-protocol.mjs';
import {
  SignedEconomicCommandError,
  buildEconomicCommandEvidence,
  hashEconomicCommandEvidence,
  issueSignedFirmOffer,
  reviseSignedFirmOffer,
} from '../src/lib/signed-economic-command.mjs';
import { createTask, openTask, reviseTask } from '../src/lib/task-protocol.mjs';

const prisma = new PrismaClient();

before(async () => {
  await prisma.$connect();
});

after(async () => {
  await prisma.$disconnect();
});

function unique(label) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function createPrincipalAgent(label, orgType) {
  const suffix = unique(label);
  const organization = await prisma.organization.create({
    data: { name: `Signed Command Org ${suffix}`, type: orgType },
  });
  const principal = await prisma.principal.create({
    data: { type: 'organization', organizationId: organization.id },
  });
  const agent = await prisma.agentIdentity.create({
    data: { principalId: principal.id, name: `Signed Command Agent ${suffix}` },
  });
  return { suffix, organization, principal, agent };
}

async function createSupplierFixture(
  label,
  {
    capabilityScopes = ['*'],
    claimCapabilities = [],
    singleContract = 1000,
    actionScopes = ['offer.issue', 'offer.revise'],
  } = {},
) {
  const fixture = await createPrincipalAgent(label, 'supplier');
  const version = await prisma.agentVersion.create({
    data: {
      agentIdentityId: fixture.agent.id,
      version: `signed-${Math.floor(Math.random() * 1000000)}`,
    },
  });
  if (claimCapabilities.length > 0) {
    await prisma.agentCapabilityClaim.createMany({
      data: claimCapabilities.map((capabilityId) => ({
        agentVersionId: version.id,
        capabilityId,
        claimStatus: 'declared',
      })),
    });
  }

  const apiMaterial = createAgentApiCredentialMaterial();
  const apiCredential = await prisma.agentCredential.create({
    data: {
      agentIdentityId: fixture.agent.id,
      kind: 'api',
      keyId: apiMaterial.keyId,
      prefix: apiMaterial.prefix,
      secretHash: apiMaterial.secretHash,
    },
  });

  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const signingKeyId = `signing-${fixture.suffix}`;
  const signingCredential = await prisma.agentCredential.create({
    data: {
      agentIdentityId: fixture.agent.id,
      kind: 'signing',
      keyId: signingKeyId,
      publicKeyJwk: publicKey.export({ format: 'jwk' }),
      algorithm: 'EdDSA',
    },
  });

  const mandatePayloadHash = sha256(`signed-command-mandate:${fixture.suffix}`);
  const mandate = await prisma.mandate.create({
    data: {
      mandateFamilyId: `signed-command-family-${fixture.suffix}`,
      version: 1,
      issuerPrincipalId: fixture.principal.id,
      subjectAgentIdentityId: fixture.agent.id,
      actionScopes,
      capabilityScopes,
      economicLimits: { singleContract, currency: 'IWC' },
      resourcePolicy: {},
      dataPolicy: { rawDataAccess: false },
      counterpartyPolicy: {},
      validFrom: new Date(Date.now() - 60_000),
      validUntil: new Date(Date.now() + 86_400_000),
      delegationAllowed: false,
      maxDelegationDepth: 0,
      payloadHash: mandatePayloadHash,
      signatureAlgorithm: 'EdDSA',
      signatureKeyId: `principal-key-${fixture.suffix}`,
      signature: `principal-signature-${fixture.suffix}`,
    },
  });

  const authentication = createV2AgentAuthenticationContext({
    principal: {
      id: fixture.principal.id,
      type: 'organization',
      status: 'active',
    },
    agent: {
      id: fixture.agent.id,
      name: fixture.agent.name,
      status: 'active',
    },
    credential: {
      id: apiCredential.id,
      keyId: apiCredential.keyId,
      kind: 'api',
      status: 'active',
    },
  });

  return {
    ...fixture,
    version,
    apiMaterial,
    apiCredential,
    signingCredential,
    signingKeyId,
    privateKey,
    mandate,
    authentication,
  };
}

function taskRevisionInput(label, capabilityIds) {
  return {
    protocolPayload: {
      objective: `Produce ${label}`,
      inputs: [{ kind: 'asset_ref', ref: `asset:${label}` }],
      expectedOutputs: [{ kind: 'artifact', schema: `urn:test:${label}:output` }],
    },
    workPayload: { constraints: { deterministic: true, label } },
    marketPayload: { budget: { currency: 'IWC', maxAmount: '500.00000000' } },
    trustPayload: { requiredReputation: { mode: 'insufficient_evidence_allowed' } },
    policyPayload: { acceptancePolicy: { mode: 'REQUESTER_ACCEPTANCE' } },
    capabilityRequirements: capabilityIds.map((capabilityId) => ({ capabilityId })),
  };
}

async function createOpenTask(label, capabilityIds) {
  const buyer = await createPrincipalAgent(`buyer-${label}`, 'buyer');
  const created = await createTask(prisma, {
    issuerPrincipalId: buyer.principal.id,
    issuerAgentIdentityId: buyer.agent.id,
    ...taskRevisionInput(`${label}-v1`, capabilityIds),
  });
  const task = await openTask(prisma, { taskId: created.task.id });
  return { buyer, task, revision: created.revision };
}

function unsignedOfferInput(taskId, supplier, label, now = new Date(), overrides = {}) {
  return {
    taskId,
    priceAmount: '25.50000000',
    currency: 'IWC',
    deliveryCommitmentSeconds: 7200,
    validUntil: new Date(now.getTime() + 60 * 60 * 1000),
    termsPayload: {
      label,
      deliverables: [{ kind: 'artifact', format: 'json' }],
    },
    nonce: unique(`signed-offer-${label}`),
    signatureAlgorithm: 'EdDSA',
    signatureKeyId: supplier.signingKeyId,
    mandateId: supplier.mandate.id,
    commandIssuedAt: new Date(now.getTime() - 1000),
    commandExpiresAt: new Date(now.getTime() + 5 * 60 * 1000),
    ...overrides,
  };
}

function signOfferCommand({
  action,
  supplier,
  task,
  taskRevision,
  offerRevision,
  input,
  now,
}) {
  const offerHash = buildFirmOfferHash(
    {
      ...input,
      supplierPrincipalId: supplier.principal.id,
      supplierAgentIdentityId: supplier.agent.id,
      taskRevision: taskRevision.revision,
      taskHash: taskRevision.contentHash,
      offerRevision,
    },
    now,
  );
  const commandEvidence = buildEconomicCommandEvidence({
    action,
    principalId: supplier.principal.id,
    agentIdentityId: supplier.agent.id,
    mandateId: input.mandateId,
    payloadHash: offerHash,
    nonce: input.nonce,
    issuedAt: input.commandIssuedAt,
    expiresAt: input.commandExpiresAt,
    signingKeyId: input.signatureKeyId,
    signatureAlgorithm: input.signatureAlgorithm,
  });
  const commandHash = hashEconomicCommandEvidence(commandEvidence);
  const supplierSignature = signDigest(
    null,
    Buffer.from(commandHash, 'hex'),
    supplier.privateKey,
  ).toString('base64url');
  return { ...input, supplierSignature, offerHash, commandHash };
}

test('M3-04: Offer hash is independent of AuthoritySnapshot and signature evidence', async () => {
  const capabilityId = `urn:test:${unique('hash')}:capability`;
  const task = await createOpenTask('hash', [capabilityId]);
  const supplier = await createSupplierFixture('hash', { claimCapabilities: [capabilityId] });
  const now = new Date();
  const base = unsignedOfferInput(task.task.id, supplier, 'hash', now);

  const first = buildFirmOfferHash({
    ...base,
    supplierPrincipalId: supplier.principal.id,
    supplierAgentIdentityId: supplier.agent.id,
    taskRevision: task.revision.revision,
    taskHash: task.revision.contentHash,
    offerRevision: 1,
    supplierAuthoritySnapshotId: 'snapshot-a',
    supplierSignature: 'signature-a',
  }, now);
  const second = buildFirmOfferHash({
    ...base,
    supplierPrincipalId: supplier.principal.id,
    supplierAgentIdentityId: supplier.agent.id,
    taskRevision: task.revision.revision,
    taskHash: task.revision.contentHash,
    offerRevision: 1,
    supplierAuthoritySnapshotId: 'snapshot-b',
    supplierSignature: 'signature-b',
  }, now);
  assert.equal(first, second);
});

test('M3-04: signed Firm Offer verifies EdDSA, resolves live authority and stores fresh snapshot evidence', async () => {
  const capabilityId = `urn:test:${unique('valid')}:capability`;
  const task = await createOpenTask('valid', [capabilityId]);
  const supplier = await createSupplierFixture('valid', { claimCapabilities: [capabilityId] });
  const now = new Date();
  const input = signOfferCommand({
    action: 'offer.issue',
    supplier,
    task: task.task,
    taskRevision: task.revision,
    offerRevision: 1,
    input: unsignedOfferInput(task.task.id, supplier, 'valid', now),
    now,
  });

  const issued = await issueSignedFirmOffer(
    prisma,
    supplier.authentication,
    input,
    { now },
  );

  assert.equal(issued.offer.status, 'active');
  assert.equal(issued.revision.offerHash, input.offerHash);
  assert.equal(issued.commandHash, input.commandHash);
  assert.equal(issued.revision.signatureKeyId, supplier.signingCredential.keyId);
  assert.equal(issued.revision.supplierSignature, input.supplierSignature);
  assert.equal(issued.revision.supplierAuthoritySnapshotId, issued.authoritySnapshot.id);
  assert.equal(issued.authoritySnapshot.principalId, supplier.principal.id);
  assert.equal(issued.authoritySnapshot.agentIdentityId, supplier.agent.id);
  assert.equal(issued.authoritySnapshot.credentialId, supplier.apiCredential.id);
  assert.equal(issued.authoritySnapshot.requestEvidence.commandHash, input.commandHash);
  assert.equal(issued.authoritySnapshot.requestEvidence.payloadHash, input.offerHash);
  assert.equal(
    issued.authoritySnapshot.requestEvidence.signingCredentialId,
    supplier.signingCredential.id,
  );
  assert.deepEqual(
    issued.authoritySnapshot.requestEvidence.capabilityIds,
    [capabilityId],
  );
});

test('M3-04: tampering economic terms after signing fails before snapshot or Offer persistence', async () => {
  const capabilityId = `urn:test:${unique('tamper')}:capability`;
  const task = await createOpenTask('tamper', [capabilityId]);
  const supplier = await createSupplierFixture('tamper', { claimCapabilities: [capabilityId] });
  const now = new Date();
  const signed = signOfferCommand({
    action: 'offer.issue',
    supplier,
    task: task.task,
    taskRevision: task.revision,
    offerRevision: 1,
    input: unsignedOfferInput(task.task.id, supplier, 'tamper', now),
    now,
  });
  const snapshotCount = await prisma.authoritySnapshot.count();

  await assert.rejects(
    issueSignedFirmOffer(
      prisma,
      supplier.authentication,
      { ...signed, priceAmount: '26.00000000' },
      { now },
    ),
    (error) => {
      assert.ok(error instanceof SignedEconomicCommandError);
      assert.equal(error.code, 'ECONOMIC_SIGNATURE_INVALID');
      return true;
    },
  );
  assert.equal(await prisma.authoritySnapshot.count(), snapshotCount);
  assert.equal(
    await prisma.offer.count({
      where: { taskId: task.task.id, supplierPrincipalId: supplier.principal.id },
    }),
    0,
  );
});

test('M3-04: API access credential cannot substitute for separate economic signing credential', async () => {
  const capabilityId = `urn:test:${unique('credential-kind')}:capability`;
  const task = await createOpenTask('credential-kind', [capabilityId]);
  const supplier = await createSupplierFixture('credential-kind', { claimCapabilities: [capabilityId] });
  const now = new Date();
  const input = unsignedOfferInput(task.task.id, supplier, 'credential-kind', now, {
    signatureKeyId: supplier.apiCredential.keyId,
  });
  const offerHash = buildFirmOfferHash({
    ...input,
    supplierPrincipalId: supplier.principal.id,
    supplierAgentIdentityId: supplier.agent.id,
    taskRevision: task.revision.revision,
    taskHash: task.revision.contentHash,
    offerRevision: 1,
  }, now);
  const commandHash = hashEconomicCommandEvidence(buildEconomicCommandEvidence({
    action: 'offer.issue',
    principalId: supplier.principal.id,
    agentIdentityId: supplier.agent.id,
    mandateId: input.mandateId,
    payloadHash: offerHash,
    nonce: input.nonce,
    issuedAt: input.commandIssuedAt,
    expiresAt: input.commandExpiresAt,
    signingKeyId: input.signatureKeyId,
    signatureAlgorithm: input.signatureAlgorithm,
  }));

  await assert.rejects(
    issueSignedFirmOffer(
      prisma,
      supplier.authentication,
      { ...input, supplierSignature: Buffer.from(commandHash).toString('base64url') },
      { now },
    ),
    (error) => {
      assert.ok(error instanceof SignedEconomicCommandError);
      assert.equal(error.code, 'SIGNING_CREDENTIAL_KIND_INVALID');
      return true;
    },
  );
});

test('M3-04: revoked signing credential blocks new commitments immediately', async () => {
  const capabilityId = `urn:test:${unique('signing-revoked')}:capability`;
  const task = await createOpenTask('signing-revoked', [capabilityId]);
  const supplier = await createSupplierFixture('signing-revoked', { claimCapabilities: [capabilityId] });
  const now = new Date();
  const input = signOfferCommand({
    action: 'offer.issue',
    supplier,
    task: task.task,
    taskRevision: task.revision,
    offerRevision: 1,
    input: unsignedOfferInput(task.task.id, supplier, 'signing-revoked', now),
    now,
  });
  await prisma.agentCredential.update({
    where: { id: supplier.signingCredential.id },
    data: { status: 'revoked', revokedAt: now },
  });

  await assert.rejects(
    issueSignedFirmOffer(prisma, supplier.authentication, input, { now }),
    (error) => {
      assert.ok(error instanceof SignedEconomicCommandError);
      assert.equal(error.code, 'SIGNING_CREDENTIAL_INACTIVE');
      return true;
    },
  );
});

test('M3-04: live Mandate singleContract limit is enforced with fixed-point comparison', async () => {
  const capabilityId = `urn:test:${unique('limit')}:capability`;
  const task = await createOpenTask('limit', [capabilityId]);
  const supplier = await createSupplierFixture('limit', {
    claimCapabilities: [capabilityId],
    singleContract: 20,
  });
  const now = new Date();
  const input = signOfferCommand({
    action: 'offer.issue',
    supplier,
    task: task.task,
    taskRevision: task.revision,
    offerRevision: 1,
    input: unsignedOfferInput(task.task.id, supplier, 'limit', now),
    now,
  });

  await assert.rejects(
    issueSignedFirmOffer(prisma, supplier.authentication, input, { now }),
    (error) => {
      assert.ok(error instanceof SignedEconomicCommandError);
      assert.equal(error.code, 'ECONOMIC_LIMIT_EXCEEDED');
      return true;
    },
  );
});

test('M3-04: all current Task capabilities must fit the live Mandate capability scope', async () => {
  const requiredCapability = `urn:test:${unique('required-capability')}`;
  const otherCapability = `urn:test:${unique('other-capability')}`;
  const task = await createOpenTask('capability-scope', [requiredCapability]);
  const supplier = await createSupplierFixture('capability-scope', {
    claimCapabilities: [requiredCapability],
    capabilityScopes: [otherCapability],
  });
  const now = new Date();
  const input = signOfferCommand({
    action: 'offer.issue',
    supplier,
    task: task.task,
    taskRevision: task.revision,
    offerRevision: 1,
    input: unsignedOfferInput(task.task.id, supplier, 'capability-scope', now),
    now,
  });

  await assert.rejects(
    issueSignedFirmOffer(prisma, supplier.authentication, input, { now }),
    (error) => {
      assert.ok(error instanceof SignedEconomicCommandError);
      assert.equal(error.code, 'CAPABILITY_NOT_AUTHORIZED');
      return true;
    },
  );
});

test('M3-04: Offer nonce is a replay guard across signed economic commands', async () => {
  const capabilityId = `urn:test:${unique('replay')}:capability`;
  const firstTask = await createOpenTask('replay-a', [capabilityId]);
  const secondTask = await createOpenTask('replay-b', [capabilityId]);
  const supplier = await createSupplierFixture('replay', { claimCapabilities: [capabilityId] });
  const now = new Date();
  const sharedNonce = unique('shared-command-nonce');
  const first = signOfferCommand({
    action: 'offer.issue',
    supplier,
    task: firstTask.task,
    taskRevision: firstTask.revision,
    offerRevision: 1,
    input: unsignedOfferInput(firstTask.task.id, supplier, 'replay-a', now, { nonce: sharedNonce }),
    now,
  });
  await issueSignedFirmOffer(prisma, supplier.authentication, first, { now });

  const second = signOfferCommand({
    action: 'offer.issue',
    supplier,
    task: secondTask.task,
    taskRevision: secondTask.revision,
    offerRevision: 1,
    input: unsignedOfferInput(secondTask.task.id, supplier, 'replay-b', now, { nonce: sharedNonce }),
    now,
  });
  await assert.rejects(
    issueSignedFirmOffer(prisma, supplier.authentication, second, { now }),
    (error) => {
      assert.ok(error instanceof SignedEconomicCommandError);
      assert.equal(error.code, 'ECONOMIC_COMMAND_REPLAY');
      return true;
    },
  );
});

test('M3-04: signed Offer revision creates fresh authority evidence and preserves immutable prior commitment', async () => {
  const capabilityId = `urn:test:${unique('revise')}:capability`;
  const task = await createOpenTask('revise', [capabilityId]);
  const supplier = await createSupplierFixture('revise', { claimCapabilities: [capabilityId] });
  const now = new Date();
  const firstInput = signOfferCommand({
    action: 'offer.issue',
    supplier,
    task: task.task,
    taskRevision: task.revision,
    offerRevision: 1,
    input: unsignedOfferInput(task.task.id, supplier, 'revise-v1', now),
    now,
  });
  const first = await issueSignedFirmOffer(prisma, supplier.authentication, firstInput, { now });

  const secondUnsigned = unsignedOfferInput(task.task.id, supplier, 'revise-v2', now, {
    offerId: first.offer.id,
    priceAmount: '27.00000000',
  });
  const secondInput = signOfferCommand({
    action: 'offer.revise',
    supplier,
    task: task.task,
    taskRevision: task.revision,
    offerRevision: 2,
    input: secondUnsigned,
    now,
  });
  const second = await reviseSignedFirmOffer(
    prisma,
    supplier.authentication,
    secondInput,
    { now },
  );

  assert.equal(second.offer.currentRevision, 2);
  assert.equal(second.revision.revision, 2);
  assert.equal(second.revision.offerHash, secondInput.offerHash);
  assert.notEqual(second.authoritySnapshot.id, first.authoritySnapshot.id);
  const revisions = await prisma.offerRevision.findMany({
    where: { offerId: first.offer.id },
    orderBy: { revision: 'asc' },
  });
  assert.deepEqual(revisions.map((revision) => revision.revision), [1, 2]);
  assert.equal(revisions[0].offerHash, firstInput.offerHash);
});

test('M3-04: Task revision after signing invalidates the pre-signed Offer command', async () => {
  const capabilityId = `urn:test:${unique('task-race')}:capability`;
  const task = await createOpenTask('task-race', [capabilityId]);
  const supplier = await createSupplierFixture('task-race', { claimCapabilities: [capabilityId] });
  const now = new Date();
  const signed = signOfferCommand({
    action: 'offer.issue',
    supplier,
    task: task.task,
    taskRevision: task.revision,
    offerRevision: 1,
    input: unsignedOfferInput(task.task.id, supplier, 'task-race', now),
    now,
  });

  await reviseTask(prisma, {
    taskId: task.task.id,
    ...taskRevisionInput('task-race-v2', [capabilityId]),
  });

  await assert.rejects(
    issueSignedFirmOffer(prisma, supplier.authentication, signed, { now }),
    (error) => {
      assert.ok(error instanceof SignedEconomicCommandError);
      assert.equal(error.code, 'ECONOMIC_SIGNATURE_INVALID');
      return true;
    },
  );
});

test('M3-04: caller cannot inject an old AuthoritySnapshot into the signed command path', async () => {
  const capabilityId = `urn:test:${unique('snapshot-injection')}:capability`;
  const task = await createOpenTask('snapshot-injection', [capabilityId]);
  const supplier = await createSupplierFixture('snapshot-injection', { claimCapabilities: [capabilityId] });
  const now = new Date();
  const input = unsignedOfferInput(task.task.id, supplier, 'snapshot-injection', now, {
    supplierAuthoritySnapshotId: 'stale-snapshot-id',
    supplierSignature: 'not-reached',
  });

  await assert.rejects(
    issueSignedFirmOffer(prisma, supplier.authentication, input, { now }),
    (error) => {
      assert.ok(error instanceof SignedEconomicCommandError);
      assert.equal(error.code, 'CALLER_AUTHORITY_SNAPSHOT_FORBIDDEN');
      return true;
    },
  );
});
