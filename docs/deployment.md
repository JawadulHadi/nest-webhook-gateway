# Deployment

The gateway deploys to **Render** (free web service from the `Dockerfile`) with a **Render free Key
Value** instance as its Redis. `render.yaml` is the blueprint for both.

| Piece | Where | Config |
| --- | --- | --- |
| HTTP API + BullMQ worker | One Render free web service (Docker) | `Dockerfile`, `render.yaml` |
| Queue | Render free Key Value (Redis-compatible), `maxmemoryPolicy: noeviction` | `render.yaml` |

## Why not Vercel

The other proof repos deploy to Vercel; this one doesn't fit it. The BullMQ `Worker` in
`src/queue.ts` runs in the same process as the API and must stay alive to pick up retries scheduled
seconds to a minute later (`BACKOFF_CAP_MS`). Vercel Functions only run while handling a request, so
a delayed retry would sit in Redis with nothing to consume it. Moving it to Vercel would mean
replacing BullMQ with a push-based queue, which is a different design rather than a deploy change.

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
