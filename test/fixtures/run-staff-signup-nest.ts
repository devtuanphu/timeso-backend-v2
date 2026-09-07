import {
  createStaffSignupTestApp,
  STAFF_SIGNUP_NEST_PORT,
  STAFF_SIGNUP_PROXY_PORT,
} from '../support/staff-self-signup-test-app';

async function main(): Promise<void> {
  let testApplication: Awaited<
    ReturnType<typeof createStaffSignupTestApp>
  > | null = null;
  let shutdownRequested = false;
  let closing: Promise<void> | null = null;
  const close = (exitCode: number) => {
    shutdownRequested = true;
    if (!testApplication) return Promise.resolve();
    if (closing) return closing;
    closing = testApplication
      .close()
      .then(() => {
        process.exitCode = exitCode;
      })
      .catch(() => {
        process.exitCode = 1;
      });
    return closing;
  };
  process.once('SIGTERM', () => void close(0));
  process.once('SIGINT', () => void close(0));

  const runId = process.env.TIMESO_STAFF_SIGNUP_RUN_ID;
  if (!runId) throw new Error('STAFF_SIGNUP_TEST_RUN_ID_REQUIRED');
  const port = Number(
    process.env.TIMESO_NEST_TEST_PORT || STAFF_SIGNUP_NEST_PORT,
  );
  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    port === STAFF_SIGNUP_PROXY_PORT
  ) {
    throw new Error('STAFF_SIGNUP_TEST_NEST_PORT_INVALID');
  }

  testApplication = await createStaffSignupTestApp({
    runId,
    seedVerifiedStaff:
      process.env.TIMESO_STAFF_SIGNUP_SEED_VERIFIED_STAFF === 'true',
  });
  if (shutdownRequested) {
    await close(0);
    return;
  }

  try {
    await testApplication.app.listen(port, '127.0.0.1');
    process.stdout.write(`TIMESO_STAFF_SIGNUP_NEST_READY:${port}\n`);
  } catch (error) {
    await close(1);
    throw error;
  }
}

void main().catch(() => {
  process.stderr.write('STAFF_SIGNUP_TEST_NEST_START_FAILED\n');
  process.exit(1);
});
