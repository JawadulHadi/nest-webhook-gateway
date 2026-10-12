# Deployment

The gateway deploys to **Render** (free web service from the `Dockerfile`) with a **Render free Key
Value** instance as its Redis. `render.yaml` is the blueprint for both.

| Piece | Where | Config |
| --- | --- | --- |
| HTTP API + BullMQ worker | One Render free web service (Docker) | `Dockerfile`, `render.yaml` |
| Queue | Render free Key Value (Redis-compatible), `maxmemoryPolicy: noeviction` | `render.yaml` |

## Vercel: stateless demo only

The full design (API plus a long-lived BullMQ worker) runs on Render, below. Vercel hosts a demo of
the HTTP side at <https://nest-webhook-gateway.vercel.app> so the API can be tried without a server:

- `vercel.json` selects the NestJS preset, which wraps `src/main.ts` in a function.
- `REDIS_URL` is **not** set there, so the gateway uses the in-memory queue and idempotency store.
  Signature checks, replay protection and idempotency within one warm instance work. Delayed
  retries do not: Vercel Functions only run while handling a request, so a retry scheduled for
  later is lost when the instance freezes. That is why the real deployment stays on Render.
- `TARGET_URLS` is empty, so verified events are accepted but not forwarded anywhere.
- No variables are required there. When `SIGNING_SECRETS` is unset and `VERCEL` is set,
  `src/main.ts` falls back to one source, `demo`, with the deliberately public secret
  `public-demo-secret`, so anyone can sign a test event. Everywhere else an empty
  `SIGNING_SECRETS` still stops the app at startup. `ADMIN_KEY` is unset too, which disables
  `/deliveries`; set it in the Vercel project to inspect deliveries.

Smoke test:

```bash
curl https://nest-webhook-gateway.vercel.app/health

BODY='{"id":"evt_1","amount":5}'; TS=$(date +%s)
SIG="sha256=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac 'public-demo-secret' | cut -d' ' -f2)"
curl -i https://nest-webhook-gateway.vercel.app/webhooks/demo -H "content-type: application/json" \
  -H "x-timestamp: $TS" -H "x-signature: $SIG" -H "x-event-id: evt_1" -d "$BODY"
```

Moving the whole gateway to Vercel would mean replacing BullMQ with a push-based queue, which is a
different design rather than a deploy change.

## Render

1. In Render: **New → Blueprint**, pick this repo.
2. When prompted, set the two secrets the blueprint can't generate:

   | Variable | Example | What it is |
   | --- | --- | --- |
   | `SIGNING_SECRETS` | `{"stripe":"whsec_..."}` | Inbound HMAC secret per source, as JSON |
   | `TARGET_URLS` | `https://example.com/webhooks` | Where verified events are delivered (comma-separated) |

   `REDIS_URL` comes from the Key Value instance, and `OUTBOUND_SECRET` and `ADMIN_KEY` are
   generated. The tuning variables in `.env.example` (`MAX_ATTEMPTS`, `BACKOFF_*`, and so on) are
   optional.
3. Deploy, then smoke test:

   ```bash
   curl https://<service>.onrender.com/health
   curl -H "x-admin-key: $ADMIN_KEY" https://<service>.onrender.com/deliveries
   ```

### Limits on the free tier

- Web instances sleep after about 15 minutes idle. A sender that retries on timeout wakes it.
- Free Key Value has no persistence, so queued retries are lost if it restarts. Demo only.
- While the web instance sleeps, the worker sleeps too, so scheduled retries wait until the next
  request wakes it.

## Local

```bash
docker compose up        # API + Redis
# or
npm ci && npm run dev    # unset REDIS_URL for the in-memory queue (single process)
```
