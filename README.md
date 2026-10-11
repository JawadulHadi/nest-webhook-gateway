# nest-webhook-gateway

Receives webhooks, proves they are authentic, deduplicates them, and delivers them to your services
with retries, jittered backoff and a dead-letter list. NestJS, TypeScript, BullMQ on Redis.

```
sender -> POST /webhooks/:source -> verify HMAC + timestamp -> claim event id (idempotency)
       -> 202 -> queue -> worker -> POST each target (signed) -> retry with backoff -> dead
```

## What it demonstrates

| Concern | How |
|---|---|
| Authenticity | HMAC-SHA256 over `timestamp.rawBody`, constant-time compare, raw bytes preserved with `rawBody: true` |
| Replay protection | Timestamp must be within 5 minutes (past or future), and is part of the signature |
| Idempotency | `source:x-event-id` claimed once. Memory store, or Redis `SET NX EX` for multiple instances |
| Fast acknowledgement | Responds 202 before delivery. Sender is never blocked by a slow target |
| Reliable delivery | BullMQ retries survive restarts. Equal-jitter exponential backoff avoids retry storms |
| Dead-letter | After `MAX_ATTEMPTS` a delivery is `dead`, listed at `GET /deliveries?status=dead` |
| Isolation | One failing target never blocks another |
| Safe defaults | Unknown source and bad signature both return 401. Admin routes stay closed if `ADMIN_KEY` is empty |

## Run

```bash
npm ci
npm test                          # unit and e2e, no services needed
redis-server &                    # or: docker compose up redis
npm run test:redis                # BullMQ and Redis idempotency against a real Redis
cp .env.example .env && docker compose up --build
```

Send a test event:

```bash
BODY='{"id":"evt_1","amount":5}'; TS=$(date +%s)
SIG="sha256=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac 'whsec_change_me' | cut -d' ' -f2)"
curl -i localhost:3000/webhooks/stripe -H "content-type: application/json" \
  -H "x-timestamp: $TS" -H "x-signature: $SIG" -H "x-event-id: evt_1" -d "$BODY"
```

## Design decisions

- **Sign the timestamp with the body.** Otherwise an attacker can replay a captured request forever.
- **Verify before parsing.** Nothing untrusted is parsed or stored until the signature passes.
- **Acknowledge, then deliver.** Webhook senders retry on slow responses, which causes duplicates.
- **Idempotency lives at the edge, receivers should still dedupe** on the `x-event-id` we forward.
- **Queue behind an interface.** `InMemoryQueue` makes tests fast and deterministic, `BullQueue` is
  the production adapter, and both are covered by the same retry logic and backoff function.

## Verified here

17 unit and e2e tests pass. The 2 Redis integration tests pass against a local `redis-server`.
The Dockerfile and compose file were not built in this environment.

## Known limits

- Delivery records live in memory. Swap `DeliveryStore` for Postgres to survive restarts.
- No per-target secrets or per-source target routing yet, and no payload size limit beyond Express's default.
- A delivery counts as an attempt only after the HTTP call, a crash mid-call can cause a duplicate delivery
  (at-least-once). Targets must be idempotent.

See `NOTES.md` for mistakes made and fixed.
