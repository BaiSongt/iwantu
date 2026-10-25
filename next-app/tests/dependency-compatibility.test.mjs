import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { loadConfigFromFile } from '@prisma/config';
import nodemailer from 'nodemailer';

const require = createRequire(import.meta.url);
// Resolve the dependency from the actual Prisma consumer, including a nested
// npm override, instead of accidentally testing an unrelated root dependency.
const prismaRequire = createRequire(require.resolve('@prisma/config'));
const deepmergeCjsFile = prismaRequire.resolve('deepmerge-ts');
const deepmergeDirectory = path.dirname(path.dirname(deepmergeCjsFile));
const deepmergePackage = JSON.parse(await readFile(path.join(deepmergeDirectory, 'package.json'), 'utf8'));
const deepmergeEsmUrl = pathToFileURL(path.join(deepmergeDirectory, deepmergePackage.exports.import)).href;
const applicationDirectory = fileURLToPath(new URL('../', import.meta.url));

async function withConfigDirectory(work) {
  const parent = path.resolve(tmpdir());
  const prefix = 'iwantu-dependency-compat-';
  const directory = await mkdtemp(path.join(parent, prefix));
  try {
    // Prevent package discovery from inheriting unrelated user configuration.
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({ private: true }));
    return await work(directory);
  } finally {
    const target = path.resolve(directory);
    assert.equal(path.dirname(target), parent, 'cleanup target must be the created temporary directory');
    assert.ok(path.basename(target).startsWith(prefix), 'cleanup target must retain the dedicated prefix');
    await rm(target, { recursive: true, force: true });
  }
}

test('Prisma-scoped deepmerge supports ordinary config merges through ESM and CommonJS', async () => {
  const esm = await import(deepmergeEsmUrl);
  const cjs = prismaRequire('deepmerge-ts');
  for (const { deepmerge } of [esm, cjs]) {
    const base = { migrations: { path: 'prisma/migrations' }, tables: { external: ['public.vendor_one'] } };
    const override = { migrations: { seed: 'node database/seed.mjs' }, tables: { external: ['public.vendor_two'] } };
    const originalBase = structuredClone(base);
    const originalOverride = structuredClone(override);
    assert.deepEqual(deepmerge(base, override), {
      migrations: { path: 'prisma/migrations', seed: 'node database/seed.mjs' },
      tables: { external: ['public.vendor_one', 'public.vendor_two'] },
    });
    assert.deepEqual(base, originalBase);
    assert.deepEqual(override, originalOverride);
  }
});

test('deepmerge recursive input is safely merged without stack exhaustion in a bounded child', () => {
  // A child-process deadline also bounds a regression that blocks the event
  // loop; a same-process test timer cannot interrupt synchronous recursion.
  const probe = `
    import assert from 'node:assert/strict';
    import { deepmerge } from ${JSON.stringify(deepmergeEsmUrl)};
    const left = { left: true }; left.self = left;
    const right = { right: true }; right.self = right;
    const merged = deepmerge(left, right);
    assert.equal(merged.left, true);
    assert.equal(merged.right, true);
    assert.equal(merged.self, merged);
    assert.equal(left.self, left);
    assert.equal(right.self, right);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    cwd: applicationDirectory, encoding: 'utf8', timeout: 5_000, windowsHide: true,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

for (const extension of ['cjs', 'mjs']) {
  test(`Prisma 6 loads a real ${extension} configuration using the patched merger`, async () => {
    await withConfigDirectory(async (directory) => {
      const configuration = {
        schema: './database/schema.prisma',
        migrations: { path: './database/migrations', seed: 'node database/seed.mjs' },
        engine: 'classic',
        datasource: { url: 'postgresql://fixture:fixture@localhost:5432/dependency_config_test' },
      };
      const configFile = `prisma.config.${extension}`;
      await writeFile(path.join(directory, configFile),
        `${extension === 'cjs' ? 'module.exports =' : 'export default'} ${JSON.stringify(configuration)};\n`);
      const loaded = await loadConfigFromFile({ configRoot: directory, configFile });
      assert.equal(loaded.error, undefined, loaded.error?.error?.message);
      assert.equal(loaded.resolvedPath, path.join(directory, configFile));
      assert.equal(loaded.config.loadedFromFile, loaded.resolvedPath);
      assert.equal(loaded.config.schema, path.join(directory, 'database', 'schema.prisma'));
      assert.equal(loaded.config.migrations.path, path.join(directory, 'database', 'migrations'));
      assert.equal(loaded.config.migrations.seed, configuration.migrations.seed);
      assert.equal(loaded.config.engine, 'classic');
      assert.deepEqual(loaded.config.datasource, configuration.datasource);
    });
  });
}

test('Nodemailer ESM entry composes app-style HTML mail with stream transport and no SMTP', async () => {
  const transport = nodemailer.createTransport({
    streamTransport: true, buffer: true, newline: 'unix', disableFileAccess: true, disableUrlAccess: true,
  });
  try {
    const info = await transport.sendMail({
      from: 'iWantU <noreply@example.test>', to: 'Recipient <recipient@example.test>',
      subject: '[iWantU] Verification', html: '<p>Your verification code is <strong>123456</strong>.</p>',
    });
    assert.deepEqual(info.envelope, { from: 'noreply@example.test', to: ['recipient@example.test'] });
    assert.equal(typeof info.messageId, 'string');
    assert.ok(Buffer.isBuffer(info.message));
    const encoded = info.message.toString('utf8');
    assert.match(encoded, /Subject: \[iWantU\] Verification/);
    assert.match(encoded, /Content-Type: text\/html/i);
    assert.match(encoded, /123456/);
  } finally {
    transport.close();
  }
});

test('Nodemailer CommonJS entry retains sendMail and structured recipient handling without network', async () => {
  const commonjs = require('nodemailer');
  const transport = commonjs.createTransport({ jsonTransport: true });
  try {
    const info = await transport.sendMail({
      from: { name: 'iWantU', address: 'noreply@example.test' },
      to: [{ name: 'Recipient', address: 'recipient@example.test' }],
      subject: 'Welcome', html: '<p>Welcome to iWantU.</p>',
    });
    const message = JSON.parse(info.message);
    assert.deepEqual(info.envelope, { from: 'noreply@example.test', to: ['recipient@example.test'] });
    assert.equal(message.subject, 'Welcome');
    assert.equal(message.html, '<p>Welcome to iWantU.</p>');
    assert.equal(message.to[0].address, 'recipient@example.test');
  } finally {
    transport.close();
  }
});
