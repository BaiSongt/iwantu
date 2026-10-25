import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const appDirectory = fileURLToPath(new URL('../../', import.meta.url));
const serverFile = path.join(appDirectory, '.next', 'standalone', 'server.js');

function availablePort() {
  return new Promise((resolve, reject) => {
    const listener = createServer();
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', () => {
      const { port } = listener.address();
      listener.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

// Starts only this test's built production server and always owns its child.
export async function startIncentiveApiServer(trustedPrograms) {
  await access(serverFile).catch(() => {
    throw new Error('Run npm run build before the R8 production HTTP tests');
  });
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  let output = '';
  let startupError;
  const child = spawn(process.execPath, [serverFile], {
    cwd: appDirectory,
    env: { ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
      PORT: String(port), HOSTNAME: '127.0.0.1',
      IWANTU_INCENTIVE_TRUSTED_PROGRAMS: JSON.stringify(trustedPrograms) },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  const capture = (chunk) => { output = (output + chunk.toString()).slice(-12_000); };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  child.once('error', (error) => { startupError = error; });
  const exited = new Promise((resolve) => child.once('exit', resolve));
  async function stop() {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
    child.kill('SIGTERM');
    await Promise.race([exited, delay(5_000, undefined, { ref: false })]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await Promise.race([exited, delay(5_000, undefined, { ref: false })]);
    }
    assert.ok(child.exitCode !== null || child.signalCode !== null,
      'R8 API test must stop its production server');
  }
  try {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (startupError || child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`R8 API server exited before readiness: ${startupError ?? ''}\n${output}`);
      }
      try {
        const response = await fetch(`${origin}/auth/login`, { signal: AbortSignal.timeout(2_000) });
        await response.text();
        if (response.status === 200) return { origin, stop };
      } catch {
        // Refused connections are expected briefly while the child starts.
      }
      await delay(100);
    }
    throw new Error(`R8 API server did not become ready within 30 seconds\n${output}`);
  } catch (error) {
    await stop();
    throw error;
  }
}
