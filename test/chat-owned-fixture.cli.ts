import {
  reserveOwnedChatFixture,
  seedOwnedChatFixture,
  teardownOwnedChatFixture,
  verifyOwnedChatFixture,
} from './chat-owned-fixture';

async function main() {
  const [action, encoded] = process.argv.slice(2);
  const input = encoded
    ? JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    : undefined;
  if (action === 'reserve') {
    process.stdout.write(JSON.stringify(await reserveOwnedChatFixture()));
    return;
  }
  if (action === 'seed') {
    process.stdout.write(JSON.stringify(await seedOwnedChatFixture(input)));
    return;
  }
  if (action === 'verify') {
    await verifyOwnedChatFixture(input);
    process.stdout.write('{"verified":true}');
    return;
  }
  if (action === 'teardown') {
    await teardownOwnedChatFixture(input);
    process.stdout.write('{"tornDown":true}');
    return;
  }
  throw new Error('CHAT_E2E_FIXTURE_ACTION_INVALID');
}

void main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : 'CHAT_E2E_FIXTURE_FAILED'}\n`,
  );
  process.exitCode = 1;
});
