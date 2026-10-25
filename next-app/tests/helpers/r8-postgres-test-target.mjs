// Both R8 database suites must reject unsafe targets before opening a connection.
export function requireR8PostgresTestTarget(env = process.env) {
  if (!env.DATABASE_URL || env.IWANTU_R8_POSTGRES_TEST !== 'iwantu_test') {
    throw new Error('R8 PostgreSQL tests require DATABASE_URL and IWANTU_R8_POSTGRES_TEST=iwantu_test');
  }
  const url = new URL(env.DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      decodeURIComponent(url.pathname) !== '/iwantu_test' ||
      url.hash !== '' ||
      (url.searchParams.size !== 0 &&
        (url.searchParams.size !== 1 || url.searchParams.get('schema') !== 'public'))) {
    throw new Error('R8 PostgreSQL tests only allow local iwantu_test with the default public schema');
  }
}
