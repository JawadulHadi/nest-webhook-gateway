export interface Config {
  signingSecrets: Record<string, string>; // inbound: source name -> shared secret
  targetUrls: string[]; // where verified events are delivered
  outboundSecret: string; // signs deliveries so targets can verify us
  adminKey: string; // protects /deliveries
  redisUrl?: string;
  maxAttempts: number;
  toleranceSeconds: number;
  backoff: { baseMs: number; capMs: number };
  sendTimeoutMs: number;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    signingSecrets: JSON.parse(env.SIGNING_SECRETS ?? '{}'),
    targetUrls: (env.TARGET_URLS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    outboundSecret: env.OUTBOUND_SECRET ?? '',
    adminKey: env.ADMIN_KEY ?? '',
    redisUrl: env.REDIS_URL,
    maxAttempts: Number(env.MAX_ATTEMPTS ?? 5),
    toleranceSeconds: Number(env.TOLERANCE_SECONDS ?? 300),
    backoff: { baseMs: Number(env.BACKOFF_BASE_MS ?? 1000), capMs: Number(env.BACKOFF_CAP_MS ?? 60000) },
    sendTimeoutMs: Number(env.SEND_TIMEOUT_MS ?? 5000),
  };
}
