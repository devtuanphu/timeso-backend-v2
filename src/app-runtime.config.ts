/** Process-launch option, intentionally independent of the database .env file. */
export function resolveLocalApiOnly(env: NodeJS.ProcessEnv): boolean {
  const value = env.TIMESO_LOCAL_API_ONLY;
  if (value === undefined || value === '' || value === 'false') return false;
  if (value !== 'true') {
    throw new Error('TIMESO_LOCAL_API_ONLY must be true or false');
  }
  if (env.NODE_ENV !== 'development') {
    throw new Error('TIMESO_LOCAL_API_ONLY requires NODE_ENV=development');
  }
  return true;
}

// Capture before Nest loads .env so module registration and lifecycle hooks
// cannot select different modes depending on ConfigModule import order.
const localApiOnly = resolveLocalApiOnly(process.env);

export const isLocalApiOnly = (): boolean => localApiOnly;

export function getAppScheduleOptions(apiOnly = isLocalApiOnly()) {
  return { cronJobs: !apiOnly, intervals: !apiOnly, timeouts: !apiOnly };
}

export function getAppBullExtraOptions(apiOnly = isLocalApiOnly()) {
  return { manualRegistration: apiOnly };
}
