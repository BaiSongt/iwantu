import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ContractFormationError,
  buildContractEvidence,
  canonicalContractJson,
  formAuthorizedContract,
  hashContractEvidence,
} from '../src/lib/contract-formation.mjs';

function evidence(overrides = {}) {
  return buildContractEvidence({
    taskId: 'task-1',
    acceptedOfferRevisionId: 'offer-revision-1',
    buyerPrincipalId: 'buyer-principal-1',
    buyerAgentIdentityId: 'buyer-agent-1',
    supplierPrincipalId: 'supplier-principal-1',
    supplierAgentIdentityId: 'supplier-agent-1',
    buyerAuthoritySnapshotId: 'buyer-authority-1',
    supplierAuthoritySnapshotId: 'supplier-authority-1',
    taskSnapshotHash: 'a'.repeat(64),
    offerSnapshotHash: 'b'.repeat(64),
    priceAmount: '25.50000000',
    currency: 'IWC',
    ...overrides,
  });
}

test('M4-01: Contract evidence canonicalization is deterministic', () => {
  const first = evidence();
  const reordered = {
    currency: first.currency,
    priceAmount: first.priceAmount,
    offerSnapshotHash: first.offerSnapshotHash,
    taskSnapshotHash: first.taskSnapshotHash,
    supplierAuthoritySnapshotId: first.supplierAuthoritySnapshotId,
    buyerAuthoritySnapshotId: first.buyerAuthoritySnapshotId,
    supplierAgentIdentityId: first.supplierAgentIdentityId,
    supplierPrincipalId: first.supplierPrincipalId,
    buyerAgentIdentityId: first.buyerAgentIdentityId,
    buyerPrincipalId: first.buyerPrincipalId,
    acceptedOfferRevisionId: first.acceptedOfferRevisionId,
    taskId: first.taskId,
    protocolVersion: first.protocolVersion,
  };

  assert.equal(canonicalContractJson(first), canonicalContractJson(reordered));
  assert.equal(hashContractEvidence(first), hashContractEvidence(reordered));
  assert.match(hashContractEvidence(first), /^[0-9a-f]{64}$/);
});

test('M4-01: effective Contract hash changes when immutable economic evidence changes', () => {
  const base = evidence();
  assert.notEqual(
    hashContractEvidence(base),
    hashContractEvidence(evidence({ offerSnapshotHash: 'c'.repeat(64) })),
  );
  assert.notEqual(
    hashContractEvidence(base),
    hashContractEvidence(evidence({ priceAmount: '25.50000001' })),
  );
  assert.notEqual(
    hashContractEvidence(base),
    hashContractEvidence(evidence({ buyerAuthoritySnapshotId: 'buyer-authority-2' })),
  );
});

test('M4-01: Contract evidence normalizes IWC amount to ledger precision', () => {
  assert.equal(evidence({ priceAmount: '25.5' }).priceAmount, '25.50000000');
});

test('M4-01: atomic formation rejects a non-Prisma caller before any economic write', async () => {
  await assert.rejects(
    () => formAuthorizedContract(null, {}),
    (error) => {
      assert.ok(error instanceof ContractFormationError);
      assert.equal(error.code, 'PROTOCOL_CLIENT_INVALID');
      return true;
    },
  );
});
