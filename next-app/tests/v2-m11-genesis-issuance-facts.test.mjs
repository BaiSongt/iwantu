import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GENESIS_ISSUANCE_PROVENANCE_VERSION,
  readGenesisIssuanceFacts,
} from '../src/lib/integrity/genesis-issuance-facts.mjs';

const BEFORE = new Date('2026-09-24T00:00:00.000Z');
const HASH_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const HASH_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const HASH_C = 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';

function fakePrisma(rows) {
  const queries = [];
  return {
    queries,
    async $queryRaw(query) {
      queries.push(query);
      return rows;
    },
  };
}

function sqlText(query) {
  return Array.isArray(query?.strings) ? query.strings.join(' ') : String(query);
}

test('R7 issuance facts: only canonical posted Genesis ledger rows are queried', async () => {
  const prisma = fakePrisma([{ principalId: 'p2', issuanceCount: 1, issuedAmount: '60.00000000', transactionHashes: [HASH_B] }]);
  const result = await readGenesisIssuanceFacts(prisma, {
    principalIds: ['p3', 'p2', 'p1'], before: BEFORE,
  });
  assert.equal(prisma.queries.length, 1);
  const sql = sqlText(prisma.queries[0]);
  assert.match(sql, /FROM "ledger_entries"/);
  assert.match(sql, /JOIN "ledger_transactions"/);
  assert.match(sql, /JOIN "ledger_accounts"/);
  assert.match(sql, /t\."type" = 'genesis'/);
  assert.match(sql, /t\."status" = 'posted'/);
  assert.match(sql, /t\."referenceType" = 'principal_genesis_allocation'/);
  assert.match(sql, /t\."postedAt" < CAST/);
  assert.match(sql, /t\."transactionHash" IS NOT NULL/);
  assert.match(sql, /array_agg\(t\."transactionHash" ORDER BY t\."transactionHash"\)/);
  assert.match(sql, /e\."side" = 'credit'/);
  assert.match(sql, /a\."type" = 'principal_available'/);
  assert.match(sql, /a\."currency" = 'IWC'/);
  assert.match(sql, /e\."provenance" ->> 'beneficiaryPrincipalId' = a\."principalId"/);
  assert.doesNotMatch(sql, /genesisOriginAmount/);

  assert.equal(result.provenanceVersion, GENESIS_ISSUANCE_PROVENANCE_VERSION);
  assert.equal(result.capitalLineageTraced, false);
  assert.deepEqual(result.principals, [
    { principalId: 'p1', issuanceCount: 0, issuedAmount: '0.00000000', transactionHashes: [] },
    { principalId: 'p2', issuanceCount: 1, issuedAmount: '60.00000000', transactionHashes: [HASH_B] },
    { principalId: 'p3', issuanceCount: 0, issuedAmount: '0.00000000', transactionHashes: [] },
  ]);
});

test('R7 issuance facts: caller order does not affect Principal ordering', async () => {
  const rows = [
    { principalId: 'a', issuanceCount: 2, issuedAmount: '15.00000000', transactionHashes: [HASH_A, HASH_B] },
    { principalId: 'c', issuanceCount: 1, issuedAmount: '30.00000000', transactionHashes: [HASH_C] },
  ];
  const one = await readGenesisIssuanceFacts(fakePrisma(rows), {
    principalIds: ['c', 'a', 'b'], before: BEFORE,
  });
  const two = await readGenesisIssuanceFacts(fakePrisma(rows), {
    principalIds: ['a', 'b', 'c'], before: BEFORE,
  });
  assert.deepEqual(one, two);
  assert.equal(one.sourceFactLayer.join(','), 'ledger_transactions,ledger_entries,ledger_accounts');
});

test('R7 issuance facts: invalid input is fail-closed before querying', async () => {
  const prisma = fakePrisma([]);
  await assert.rejects(
    () => readGenesisIssuanceFacts(prisma, { principalIds: ['a', 'a', 'b'], before: BEFORE }),
    /distinct/,
  );
  await assert.rejects(
    () => readGenesisIssuanceFacts(prisma, { principalIds: ['a', 'b', 'c'], before: new Date('invalid') }),
    /valid Date/,
  );
  assert.equal(prisma.queries.length, 0);
});

test('R7 issuance facts: forged, duplicate or inconsistent query rows are rejected', async () => {
  const input = { principalIds: ['a', 'b', 'c'], before: BEFORE };
  for (const rows of [
    [{ principalId: 'x', issuanceCount: 1, issuedAmount: '1.00000000' }],
    [{ principalId: 'a', issuanceCount: 1, issuedAmount: '1.00000000' }, { principalId: 'a', issuanceCount: 1, issuedAmount: '1.00000000' }],
    [{ principalId: 'a', issuanceCount: 0, issuedAmount: '1.00000000' }],
    [{ principalId: 'a', issuanceCount: 1, issuedAmount: '-5.00000000' }],
    [{ principalId: 'a', issuanceCount: 1, issuedAmount: '0.00000000' }],
    [{ principalId: 'a', issuanceCount: 1, issuedAmount: '1.00000000', transactionHashes: [] }],
    [{ principalId: 'a', issuanceCount: 1, issuedAmount: '1.00000000', transactionHashes: ['not-a-hash'] }],
    [{ principalId: 'a', issuanceCount: 2, issuedAmount: '2.00000000', transactionHashes: [HASH_A, HASH_A] }],
    [{ principalId: 'a', issuanceCount: 2, issuedAmount: '2.00000000', transactionHashes: [HASH_B, HASH_A] }],
  ]) {
    await assert.rejects(() => readGenesisIssuanceFacts(fakePrisma(rows), input));
  }
});

test('R7 issuance facts: reader performs no economic mutation', async () => {
  const prisma = fakePrisma([]);
  await readGenesisIssuanceFacts(prisma, {
    principalIds: ['a', 'b', 'c'], before: BEFORE,
  });
  const sql = sqlText(prisma.queries[0]);
  assert.match(sql, /^\s*SELECT/);
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
});
