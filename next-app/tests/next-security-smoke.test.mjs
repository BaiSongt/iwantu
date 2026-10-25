import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test, { after, before } from 'node:test';

const appDirectory = fileURLToPath(new URL('../', import.meta.url));
const serverFile = path.join(appDirectory, '.next', 'standalone', 'server.js');
let serverProcess;
let serverExited;
let origin;
let output = '';
let startupError;

function captureOutput(chunk) {
  output = (output + chunk.toString()).slice(-12_000);
}

function availableLocalPort() {
  return new Promise((resolve, reject) => {
    const listener = createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const { port } = listener.address();
      listener.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function request(route, headers = {}) {
  return fetch(new URL(route, origin), {
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(5_000),
  });
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must point to a running test database');
  assert.ok(process.env.JWT_SECRET, 'JWT_SECRET is required for production authentication checks');
  await access(serverFile).catch(() => {
    throw new Error('Run npm run build before the production security smoke test');
  });

  const port = await availableLocalPort();
  origin = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, [serverFile], {
    cwd: appDirectory,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      NEXT_TELEMETRY_DISABLED: '1',
      HOSTNAME: '127.0.0.1',
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  serverProcess.stdout.on('data', captureOutput);
  serverProcess.stderr.on('data', captureOutput);
  serverProcess.once('error', (error) => { startupError = error; });
  serverExited = new Promise((resolve) => serverProcess.once('exit', resolve));

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (startupError || serverProcess.exitCode !== null || serverProcess.signalCode !== null) {
      throw new Error(`Production server exited before readiness: ${startupError ?? ''}\n${output}`);
    }
    try {
      const response = await request('/auth/login');
      await response.text();
      if (response.status === 200) return;
    } catch {
      // Startup may briefly refuse connections; fail with bounded server logs below.
    }
    await delay(100);
  }
  throw new Error(`Production server did not become ready within 30 seconds\n${output}`);
}, { timeout: 40_000 });

after(async () => {
  if (!serverProcess?.pid || serverProcess.exitCode !== null || serverProcess.signalCode !== null) return;
  serverProcess.kill('SIGTERM');
  await Promise.race([serverExited, delay(5_000, undefined, { ref: false })]);
  if (serverProcess.exitCode === null && serverProcess.signalCode === null) {
    serverProcess.kill('SIGKILL');
    await Promise.race([serverExited, delay(5_000, undefined, { ref: false })]);
  }
  assert.ok(serverProcess.exitCode !== null || serverProcess.signalCode !== null,
    'The smoke test must stop its production server');
}, { timeout: 12_000 });

const unauthorizedRequests = [
  { name: 'absent cookie', headers: {} },
  { name: 'invalid cookie', headers: { cookie: 'iwantu_session=invalid-session-token' } },
  {
    name: 'forged identity headers',
    headers: { 'x-user-id': 'forged-admin', 'x-user-role': 'admin' },
  },
  {
    name: 'forged middleware subrequest headers',
    headers: {
      'x-user-id': 'forged-admin',
      'x-user-role': 'admin',
      'x-middleware-subrequest': 'src/middleware:src/middleware:src/middleware:src/middleware:src/middleware',
    },
  },
  {
    name: 'invalid cookie with forged proxy subrequest headers',
    headers: {
      cookie: 'iwantu_session=invalid-session-token',
      'x-user-id': 'forged-admin',
      'x-user-role': 'admin',
      'x-middleware-subrequest': 'src/proxy:src/proxy:src/proxy:src/proxy:src/proxy',
    },
  },
];

test('production public home and login pages remain available', async () => {
  for (const route of ['/', '/auth/login']) {
    const response = await request(route);
    await response.text();
    assert.equal(response.status, 200, route);
  }
});

test('production protected pages reject missing, invalid and forged authentication', async (t) => {
  for (const { name, headers } of unauthorizedRequests) {
    await t.test(name, async () => {
      for (const route of ['/dashboard', '/messages', '/demands/publish', '/products/publish']) {
        const response = await request(route, headers);
        await response.text();
        assert.equal(response.status, 307, `${route}: ${name}`);
        const location = new URL(response.headers.get('location'), origin);
        assert.equal(location.origin, origin);
        assert.equal(location.pathname, '/auth/login');
        assert.equal(location.searchParams.get('callbackUrl'), route);
      }
    });
  }
});

test('production user API independently rejects missing, invalid and forged authentication', async (t) => {
  for (const { name, headers } of unauthorizedRequests) {
    await t.test(name, async () => {
      const response = await request('/api/users/me', headers);
      await response.text();
      assert.equal(response.status, 401, name);
    });
  }
});

test('production health endpoint reaches the configured test database', async () => {
  const response = await request('/api/health');
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.database, 'connected');
});
