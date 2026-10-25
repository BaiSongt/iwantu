import assert from 'node:assert/strict';
import test from 'node:test';
import { requireR8PostgresTestTarget } from './helpers/r8-postgres-test-target.mjs';

const environment = (DATABASE_URL) => ({ DATABASE_URL, IWANTU_R8_POSTGRES_TEST: 'iwantu_test' });

test('R8 database target accepts local PostgreSQL and the CI public schema', () => {
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    for (const protocol of ['postgres:', 'postgresql:']) {
      for (const query of ['', '?schema=public']) {
        assert.doesNotThrow(() => requireR8PostgresTestTarget(environment(
          `${protocol}//postgres:postgres@${host}:55432/iwantu_test${query}`,
        )));
      }
    }
  }
});

test('R8 database target rejects missing opt-in, remote hosts, other databases and connection overrides', () => {
  const base = 'postgresql://postgres:postgres@localhost:55432/iwantu_test';
  for (const env of [{}, { DATABASE_URL: base }, { ...environment(base), IWANTU_R8_POSTGRES_TEST: 'true' }]) {
    assert.throws(() => requireR8PostgresTestTarget(env));
  }
  for (const url of [
    'invalid-url',
    base.replace('postgresql:', 'https:'),
    base.replace('localhost', 'db.example.com'),
    base.replace('localhost', 'localhost.example.com'),
    base.replace('iwantu_test', 'iwantu'),
    base + '/other',
    base + '?schema=private',
    base + '?schema=public&schema=private',
    base + '?schema=public&host=db.example.com',
    base + '?host=db.example.com',
    base + '?options=-csearch_path%3Dprivate',
    base + '?sslmode=disable',
    base + '#fragment',
  ]) {
    assert.throws(() => requireR8PostgresTestTarget(environment(url)), url);
  }
});
