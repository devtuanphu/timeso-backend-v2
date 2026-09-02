import { readFileSync } from 'fs';
import { spawn, spawnSync } from 'child_process';
import { join } from 'path';

import { stopOwnedChatBackend } from '../../../test/chat-owned-app';

const workspaceFile = (...parts: string[]) =>
  readFileSync(join(process.cwd(), '..', ...parts), 'utf8');
const backendTest = (name: string) =>
  readFileSync(join(process.cwd(), 'test', name), 'utf8');

describe('chat isolated E2E evidence artifacts', () => {
  it('owns fixture setup/verification/teardown and refuses arbitrary context', () => {
    const runner = workspaceFile(
      'timeso_owner',
      'e2e',
      'scripts',
      'run-chat-reliability.mjs',
    );
    const assertion = workspaceFile(
      'timeso_owner',
      'e2e',
      'scripts',
      'assert-chat-reliability.mjs',
    );
    expect(runner).toContain("runFixtureCli('reserve')");
    expect(runner).toContain("runFixtureCli('seed', reservation)");
    expect(runner).toContain("runFixtureCli('verify', fixture)");
    expect(runner).toContain("runFixtureCli('teardown', reservation)");
    expect(runner).toContain('finally');
    expect(runner).not.toMatch(
      /process\.env\.CHAT_E2E_(?:API_URL|GROUP_ID|OWNER_ACCESS_TOKEN|STAFF_ACCESS_TOKEN)/,
    );
    expect(assertion).toContain("runFixtureCli('verify', encoded)");
    expect(assertion).not.toMatch(
      /process\.env\.CHAT_E2E_(?:API_URL|GROUP_ID|OWNER_ACCESS_TOKEN|STAFF_ACCESS_TOKEN)/,
    );
  });

  it('boots real application providers instead of replacing chat authorization', () => {
    const command = backendTest('chat-message-command.pg-e2e-spec.ts');
    const launcher = backendTest('chat-owned-app.ts');
    expect(command).toContain('startOwnedChatBackend');
    expect(command).toContain('/api/chat-groups/${fixture.groupId}/messages');
    expect(command).not.toContain('overrideGuard');
    expect(command).not.toContain('createAuthorizationHarness');
    expect(launcher).toContain("'dist', 'src', 'main.js'");
    expect(launcher).not.toContain("'dist', 'main.js'");
    expect(launcher).toContain('STDERR_LIMIT_BYTES');
    expect(launcher).toContain(
      "sanitizeStartupCategory(stderr.toString('utf8'))",
    );
    expect(launcher).not.toContain(
      'CHAT_E2E_BACKEND_EXITED_BEFORE_READY:${stderr}',
    );
  });

  it('drives production outbox and singleton services rather than copied claim SQL', () => {
    const outbox = backendTest('chat-outbox-singleton.pg-e2e-spec.ts');
    expect(outbox).toContain('new ChatOutboxDispatcherService');
    expect(outbox).toContain('new ChatAuthorizationService');
    expect(outbox).toContain('new ChatSingleInstanceRuntimeGuardService');
    expect(outbox).not.toMatch(/WITH\s+candidate(?:s)?\s+AS/i);
    expect(outbox).toContain("VALUES($1,$2,$3,$4,$5,'text',$6,now(),now())");
    expect(outbox).not.toContain(
      "VALUES($1,$2,$3,$4,$5,'text',$3,now(),now())",
    );
  });

  it('allows the owned fixture CLI to import the PG harness outside Jest', () => {
    const environment = { ...process.env };
    delete environment.TIMESO_ISOLATED_DB;
    delete environment.TIMESO_TEST_DATABASE_URL;
    const result = spawnSync(
      process.execPath,
      [
        join(process.cwd(), 'node_modules/ts-node/dist/bin.js'),
        '--transpile-only',
        join(process.cwd(), 'test/chat-owned-fixture.cli.ts'),
        'invalid-action',
      ],
      { cwd: process.cwd(), env: environment, encoding: 'utf8' },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('CHAT_E2E_FIXTURE_ACTION_INVALID');
    expect(result.stderr).not.toContain('describe is not defined');
  });

  it('stops an owned backend concurrently and again after SIGTERM exit', async () => {
    const child = spawn(
      process.execPath,
      ['-e', 'setInterval(() => {}, 1000)'],
      {
        stdio: 'ignore',
      },
    );
    const backend = { child, port: 1, baseUrl: 'http://127.0.0.1:1' };

    await Promise.all([
      stopOwnedChatBackend(backend),
      stopOwnedChatBackend(backend),
    ]);
    expect(child.signalCode).toBe('SIGTERM');
    await expect(
      Promise.race([
        stopOwnedChatBackend(backend).then(() => 'stopped'),
        new Promise((resolve) => setTimeout(() => resolve('timeout'), 250)),
      ]),
    ).resolves.toBe('stopped');
  });
});
