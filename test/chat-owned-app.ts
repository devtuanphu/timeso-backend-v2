import { ChildProcess, spawn } from 'child_process';
import { existsSync } from 'fs';
import { createServer } from 'net';
import { join } from 'path';

import {
  isolatedBackendEnvironment,
  ReservedChatFixture,
} from './chat-owned-fixture';

export interface OwnedChatBackend {
  child: ChildProcess;
  port: number;
  baseUrl: string;
}

const STDERR_LIMIT_BYTES = 8 * 1024;
const stopInFlight = new WeakMap<ChildProcess, Promise<void>>();

export async function startOwnedChatBackend(
  reservation: ReservedChatFixture,
): Promise<OwnedChatBackend> {
  const port = await reserveLoopbackPort();
  const compiledEntry = join(process.cwd(), 'dist', 'src', 'main.js');
  if (!existsSync(compiledEntry)) {
    throw new Error('CHAT_E2E_BACKEND_BUILD_REQUIRED');
  }
  const child = spawn(process.execPath, [compiledEntry], {
    cwd: process.cwd(),
    env: isolatedBackendEnvironment(reservation, port),
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const startupDiagnostic = captureStartupDiagnostic(child);
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForBackend(child, baseUrl, startupDiagnostic);
    return { child, port, baseUrl };
  } catch (error) {
    await stopOwnedChatBackend({ child, port, baseUrl });
    throw error;
  }
}

export async function stopOwnedChatBackend(
  backend: OwnedChatBackend | undefined,
): Promise<void> {
  if (!backend) return;
  const child = backend.child;
  if (hasChildExited(child)) return;
  const existing = stopInFlight.get(child);
  if (existing) return existing;

  const stopping = new Promise<void>((resolve) => {
    let settled = false;
    const timers: {
      terminate?: ReturnType<typeof setTimeout>;
      forced?: ReturnType<typeof setTimeout>;
    } = {};
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timers.terminate) clearTimeout(timers.terminate);
      if (timers.forced) clearTimeout(timers.forced);
      child.off('exit', finish);
      child.off('close', finish);
      resolve();
    };

    child.once('exit', finish);
    child.once('close', finish);
    if (hasChildExited(child)) {
      finish();
      return;
    }

    if (!child.killed) {
      child.kill('SIGTERM');
    }
    if (hasChildExited(child)) {
      finish();
      return;
    }

    timers.terminate = setTimeout(() => {
      if (hasChildExited(child)) {
        finish();
        return;
      }
      child.kill('SIGKILL');
      timers.forced = setTimeout(finish, 1_000);
    }, 5_000);
  });
  stopInFlight.set(child, stopping);
  try {
    await stopping;
  } finally {
    stopInFlight.delete(child);
  }
}

function hasChildExited(child: ChildProcess): boolean {
  return (
    child.exitCode !== null ||
    child.signalCode !== null ||
    child.pid === undefined
  );
}

async function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function waitForBackend(
  child: ChildProcess,
  baseUrl: string,
  startupDiagnostic: StartupDiagnostic,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (startupDiagnostic.spawnFailed()) {
      throw new Error('CHAT_E2E_BACKEND_START_FAILED:PROCESS_START_FAILED');
    }
    if (child.exitCode !== null) {
      throw new Error(
        `CHAT_E2E_BACKEND_EXITED_BEFORE_READY:${startupDiagnostic.category()}`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}/api`);
      if (response.ok) return;
    } catch {
      // The isolated application is still booting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `CHAT_E2E_BACKEND_READY_TIMEOUT:${startupDiagnostic.category()}`,
  );
}

interface StartupDiagnostic {
  category(): string;
  spawnFailed(): boolean;
}

function captureStartupDiagnostic(child: ChildProcess): StartupDiagnostic {
  let stderr = Buffer.alloc(0);
  let failedToSpawn = false;
  child.stderr?.on('data', (chunk: Buffer | string) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    stderr = Buffer.concat([stderr, bytes]);
    if (stderr.byteLength > STDERR_LIMIT_BYTES) {
      stderr = stderr.subarray(stderr.byteLength - STDERR_LIMIT_BYTES);
    }
  });
  child.once('error', () => {
    failedToSpawn = true;
  });
  return {
    category: () => sanitizeStartupCategory(stderr.toString('utf8')),
    spawnFailed: () => failedToSpawn,
  };
}

function sanitizeStartupCategory(stderr: string): string {
  if (stderr.includes('CHAT_SINGLETON_ALREADY_ACTIVE')) {
    return 'CHAT_SINGLETON_ALREADY_ACTIVE';
  }
  if (/JWT_(?:SECRET|REFRESH_SECRET)|AUTH_CONFIG/i.test(stderr)) {
    return 'AUTH_CONFIG_INVALID';
  }
  if (/DATABASE_|ECONNREFUSED|password authentication failed/i.test(stderr)) {
    return 'DATABASE_STARTUP_FAILED';
  }
  if (/MODULE_NOT_FOUND|Cannot find module/i.test(stderr)) {
    return 'MODULE_LOAD_FAILED';
  }
  if (stderr.includes('BOOTSTRAP_FAILED')) {
    return 'BOOTSTRAP_FAILED';
  }
  return 'PROCESS_EXITED';
}
