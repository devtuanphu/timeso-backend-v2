# Local API development with the existing test database

Run `npm run start:dev` from this repository. It keeps `.env` unchanged and
selects API-only mode using process-launch flags, binding HTTP to loopback
(`127.0.0.1`, existing `PORT` or 3000). The iOS simulator can use this address.

This mode allows REST registration, login and store discovery while another
backend holds the shared database's chat singleton lock. It does not acquire
that lock, activate chat, register cron/interval/timeout tasks or start BullMQ
workers. Authenticated chat HTTP requests remain unavailable and chat sockets
are rejected. Startup does not proactively refresh Zalo credentials or create
the cron-lock table. Managed database schema behavior is unchanged.

OTP requests still use the configured real Zalo provider, and can refresh its
credentials on demand. This is not read-only mode: requests can write to the
configured database and call external providers. Only use the agreed test data.
Queue producers are unchanged: jobs can be enqueued but remain pending if no
worker serves that Redis instance. Do not use this mode to validate chat,
attendance background processing or scheduled workflows.

`npm start`, `npm run start:debug`, and `npm run start:prod` retain full runtime
behavior and require the chat singleton lock. For a full local runtime use
`npm run start:debug` against an isolated, correctly configured database; do not
stop a remote backend to free its lock. No deployment, migration or mobile build
is required for this local startup change.

`TIMESO_LOCAL_API_ONLY` is a process-launch option, not a `.env` setting. Its
value is captured before Nest configuration loads and shared across all startup
paths. `true` requires `NODE_ENV=development`; invalid values fail startup.
