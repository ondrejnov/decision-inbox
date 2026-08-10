# Decision Inbox MVP

Small Electron + Fastify TypeScript monorepo for reviewing Agentis questions and approvals.

## Layout

- `apps/api` — Fastify BFF. It owns the Agentis network calls and persists only Android push registration metadata in SQLite; it never persists or logs the forwarded user token or decision content.
- `apps/desktop` — Electron main process, typed preload IPC, and React/Tailwind renderer.
- `apps/mobile` — Flutter Android client using Keystore-backed credentials, the BFF REST/SSE API, and native notifications.
- `packages/contracts` — shared Zod schemas and TypeScript types.

Node 22 is the supported runtime. The repository uses npm workspaces and the built-in `node:sqlite` API for BFF push registrations.

## Run locally

```bash
npm install
npm test
npm run typecheck
npm run build
```

Start the BFF and renderer dev servers:

```bash
export AGENTIS_API_URL="https://agentis.example.com"
export AGENTIS_SESSION_RPC="auth.user_data"
export WEBHOOK_ALLOWED_IPS="203.0.113.10/32"
./run-dev.sh
```

The script prints `http://127.0.0.1:8787` (BFF) and `http://127.0.0.1:5173` (renderer). Stop them with `./stop-dev.sh`. For a visual renderer-only demo with safe sample data, use `VITE_DEMO_MODE=1 ./run-dev.sh`; demo mode is not used by a production Electron build.

After `npm run build`, launch the desktop app with:

```bash
DECISION_BFF_URL="https://decisions.example.com" \
AGENTIS_WEB_URL="https://agentis.cz" \
npm run start --workspace @decision-inbox/desktop
```

Run the Android client from `apps/mobile` with Flutter 3.44 or newer:

```bash
flutter pub get
flutter run
```

See `apps/mobile/README.md` for emulator URL overrides, validation commands, release signing, security behavior, and Android background-delivery constraints.

The desktop runtime reads these fixed URLs from environment/runtime configuration. The renderer never calls the BFF directly. `contextIsolation` is enabled, `nodeIntegration` is disabled, and only the typed methods in `src/preload.ts` cross the boundary.

## Configuration

### BFF

| Variable | Default | Purpose |
| --- | --- | --- |
| `BFF_HOST` | `127.0.0.1` | Listen host |
| `BFF_PORT` | `8787` | Listen port |
| `AGENTIS_API_URL` | none (invalid placeholder) | Existing Agentis origin; client posts JSON-RPC to its `/api` endpoint |
| `AGENTIS_SESSION_RPC` | `auth.user_data` | Authenticated Agentis RPC used for session and tenant identity |
| `WEBHOOK_ALLOWED_IPS` | empty | Required exact IP/CIDR allowlist for the webhook |
| `TRUSTED_PROXY_CIDRS` | empty | Proxies allowed to supply the first `X-Forwarded-For` address |
| `BFF_CORS_ORIGINS` | disabled | Comma-separated allowed origins; `*` is suitable only for local development |
| `WEBHOOK_IDEMPOTENCY_TTL_MS` | `900000` | In-memory webhook deduplication TTL |
| `WEBHOOK_IDEMPOTENCY_MAX_ENTRIES` | `10000` | In-memory deduplication bound |
| `SQLITE_PATH` | `.data/decision-inbox.sqlite` (`:memory:` in tests) | SQLite file containing installation ID, FCM token, tenant/user ownership, platform, and timestamps |
| `FIREBASE_PROJECT_ID` | empty (push disabled) | Firebase project used by the FCM HTTP v1 sender |

FCM uses `google-auth-library` Application Default Credentials (ADC) with the `firebase.messaging` scope. In production, prefer workload identity. If a service-account key is unavoidable, mount it from a Kubernetes Secret and set `GOOGLE_APPLICATION_CREDENTIALS` to the mounted JSON path; never put credentials in the image, manifest, repository, or `SQLITE_PATH`. The service account needs permission to send Firebase Cloud Messaging messages for `FIREBASE_PROJECT_ID`.

### Desktop

| Variable | Default | Purpose |
| --- | --- | --- |
| `DECISION_BFF_URL` | `http://127.0.0.1:8787` | Fixed BFF URL used by the main process |
| `AGENTIS_WEB_URL` | `https://agentis.cz` | Fixed Agentis URL used by the Source task action |
| `ELECTRON_RENDERER_URL` | packaged renderer | Local Vite URL for development Electron runs |

The Agentis token is tested and stored as ciphertext using Electron `safeStorage` in the main process. There is no plaintext fallback. During onboarding the main process captures keyboard/paste input through Electron's `before-input-event`; the renderer receives only the masked character count and never receives the token. Subsequent session, list, resolve, SSE, and logout operations are main-process operations. If OS secure storage is unavailable, persistence and notifications fail closed.

Settings include global notifications, notify-while-active, close-to-tray, and autostart. Autostart is enabled only after onboarding consent. Native notifications are silent, burst-aggregated, use the task title for a single item, and open the pending inbox rather than a specific card. Aggregated notifications keep the generic `Decision Inbox` title. Encrypted baseline keys prevent restart spam; the first sync may show one summary for existing pending items.

## BFF API and Agentis contract

Protected BFF requests carry the per-user Agentis token in `X-Auth-Token`. The BFF forwards it only to Agentis and does not accept a client-supplied tenant identity.

| BFF route | Agentis RPC |
| --- | --- |
| `GET /v1/session` | configured `AGENTIS_SESSION_RPC` (default `auth.user_data`) |
| `GET /v1/decisions?view=pending\|history&page=1` | `decision.get_list` with `{ qo: { view, page } }` |
| `GET /v1/decisions/pending-count` | `decision.get_pending_count` |
| `POST /v1/decisions/resolve` question | `task.question_reply` with `{ external_id, results: [{ question_id, selected_options, answer_text }] }` |
| `POST /v1/decisions/resolve` approval | `task.approve_reply` with `{ external_id, approved, comment }` |
| `PUT /v1/push/registration` | Resolves session identity, then upserts `{ installationId, pushToken, platform: "android" }` in SQLite |
| `DELETE /v1/push/registration/:installationId` | Resolves session identity, then removes only a matching installation/tenant/user registration |
| `PUT /v1/desktop/presence` | Resolves session identity, then records or clears ephemeral active desktop presence |

The resolve request intentionally includes `decisionKind`, `externalId`, `taskId`, and `runId`. The task/run IDs are source-link context; the Agentis question contract uses `external_id` and `results`, while approval uses the explicit boolean `approved` mapping.

Both push registration routes return `{ "ok": true }`. Registration bodies and path parameters are strict: installation IDs are limited to 256 characters, FCM tokens to 32-4096 characters, and client-supplied tenant/user identity is rejected. The BFF derives both identities from `AGENTIS_SESSION_RPC`, retains at most 20 recent installations per tenant user, and stores no Agentis token or decision content in SQLite.

The current Agentis list payload is normalized from the existing shape: `type`, `external_id`, numeric `status`, `task.id`/`task.title`, `run_id`, `question.questions[]`, or `approval.title`/`approval.description`. The BFF does not invent a second decision store.

Example question request:

```json
{
  "decisionKind": "question",
  "externalId": "question-123",
  "taskId": "42",
  "runId": "run-7",
  "answers": [{ "questionId": "q-1", "optionIds": ["prod"] }]
}
```

Agentis RPC errors are returned with their status and code. In particular `already_resolved` and `decision_cancelled` remain `409` responses so the card can show an inline stale banner and refetch.

## Webhook and SSE security

`POST /v1/webhooks/agentis/decision-changed` accepts one strict `decision.changed` envelope:

```json
{
  "schema_version": 1,
  "event_id": "evt-1",
  "transition": "created",
  "decision_kind": "question",
  "tenant_id": "tenant-1",
  "external_id": "question-123",
  "task_id": "42",
  "run_id": "run-7",
  "status": "pending",
  "occurred_at": "2026-08-07T10:00:00.000Z"
}
```

Cancellation refresh events may omit `decision_kind`, `external_id`, and `run_id` when one task/run operation cancels more than one decision. Created and answered events always include those fields.

On the Agentis side, set `AGAPPROVE_DECISION_WEBHOOK_URL` to this webhook URL and restrict ingress on the BFF to the Agentis egress CIDR. Agentis enqueues the event after the decision write and Celery retries transport failures up to five times. This is intentionally not a transactional outbox: a process failure between the write and queue handoff can lose the hint, and the desktop's 60-second refresh/startup sync repairs state.

The webhook contains no decision text. It uses IP/CIDR allowlisting and bounded in-memory event IDs with a TTL; it deliberately has no HMAC. This is a deployment tradeoff: the endpoint must be private to the configured source network and served behind public HTTPS, because an allowed source can forge events. A process restart loses the deduplication/replay window. If a reverse proxy is used, set `TRUSTED_PROXY_CIDRS` to the proxy's source ranges. `X-Forwarded-For` is ignored otherwise; arbitrary client-supplied forwarding headers are never trusted.

After validation and idempotency acceptance, a `created` event whose status is `pending` is dispatched to Android registrations for that tenant unless the same user has a fresh active-desktop heartbeat. The Electron main process measures system-wide input idle time through Electron's `powerMonitor`, not window focus: after five minutes without OS input, while Windows is locked/suspended, or when the heartbeat expires, mobile push is enabled again. Active heartbeats are refreshed every 30 seconds and expire in the BFF after 75 seconds, so an offline or terminated desktop fails open for mobile delivery. Presence is ephemeral, contains no decision content, and is scoped to the authenticated tenant/user. FCM notifications use the generic title/body `Decision Inbox` / `A decision needs your attention.`, Android high priority, and channel `decision_inbox_pending`; only a schema version, pending-inbox route, and opaque event ID are included as data. Invalid or sender-mismatched FCM tokens are deleted. FCM provider/network failures are logged without registration tokens and never fail the webhook response. Duplicate, answered, and cancelled events do not send push notifications.

`GET /v1/events` resolves the tenant from the authenticated Agentis session RPC. The SSE payload omits `tenant_id`; tenant matching happens inside the BFF. Connections send keepalives, retain a small in-memory replay window, and honor `Last-Event-ID`. Desktop reconnects with backoff and refetches after events/reconnect. Horizontal deployments need a shared registration store, event broker, and idempotency store for stronger guarantees; this deployment remains single-process and mounts its SQLite database on persistent storage.

## Offline behavior

The renderer retains the last successful decision page in memory for the lifetime of the process and displays it read-only when the BFF is unavailable. It never queues resolves. SSE reconnects and the 60-second pending-count poll trigger a full refresh after connectivity returns.

## Releases

There is no updater. Build manually for the supported targets:

```bash
npm run dist:linux --workspace @decision-inbox/desktop   # AppImage + deb
npm run dist:windows --workspace @decision-inbox/desktop # NSIS
```

The BFF should be deployed as a public HTTPS service with a restrictive webhook ingress rule, no body/token logging, and the configured Agentis origin. Electron release signing, packaging credentials, and OS notification smoke tests are environment-specific and are not included here.

The Kubernetes manifest in `k8s/api-bff.yaml` deploys one BFF replica to the `apps` namespace, creates a `ReadWriteOnce` PVC, mounts it at `/data`, and sets `SQLITE_PATH=/data/decision-inbox.sqlite`. Before applying it, replace the example image and ingress host/TLS secret as needed, configure `WEBHOOK_ALLOWED_IPS` and `TRUSTED_PROXY_CIDRS`, and set `FIREBASE_PROJECT_ID`. Provide ADC with workload identity or mount a service-account JSON Kubernetes Secret and set `GOOGLE_APPLICATION_CREDENTIALS` to that file. Build the image from the repository root with:

```bash
docker build -f apps/api/Dockerfile -t registry.example.com/agapprove-api:latest .
kubectl apply -f k8s/api-bff.yaml
```

## Test scope and limitations

`npm test` covers RPC mapping, error preservation, 401s, strict push contracts, SQLite registration persistence/upsert/isolation/unregister, webhook schema/allowlist/idempotency/push dispatch, tenant-scoped SSE fan-out/replay, question/approval/history/stale card behavior, encrypted stores, and notification baseline logic. Live FCM and full OS notification smoke tests are not run in this Linux build environment; provider dispatch uses focused fakes and desktop notification delivery uses Electron's native silent notification API in the app.
