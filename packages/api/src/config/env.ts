import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  JWT_SECRET: z.string().min(32),
  MASTER_API_KEY: z.string().min(16),
  API_KEY_PREFIX: z.string().default('kyc_live_'),

  STORAGE_PATH: z.string().default('./storage'),
  DB_PATH: z.string().default('./kyc.db'),

  SESSION_TTL_HOURS: z.coerce.number().default(24),
  SESSION_TOKEN_TTL_HOURS: z.coerce.number().default(2),

  JOB_POLL_INTERVAL_MS: z.coerce.number().default(500),
  JOB_MAX_CONCURRENCY: z.coerce.number().default(4),

  // AWS Rekognition (face match + liveness)
  AWS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().min(16),
  AWS_SECRET_ACCESS_KEY: z.string().min(16),

  // Scoped credentials for browser-side Amplify FaceLivenessDetector
  // IAM user: kyc-liveness-client — ONLY has rekognition:StartFaceLivenessSession
  AWS_LIVENESS_ACCESS_KEY_ID: z.string().min(16),
  AWS_LIVENESS_SECRET_ACCESS_KEY: z.string().min(16),

  RISK_APPROVE_THRESHOLD: z.coerce.number().default(0.8),
  RISK_MANUAL_THRESHOLD: z.coerce.number().default(0.55),

  ADDRESS_DOC_MAX_AGE_DAYS: z.coerce.number().default(90),

  CORS_ORIGINS: z.string().default('http://localhost:3000'),
});

function loadEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:');
    for (const err of result.error.errors) {
      console.error(`  ${err.path.join('.')}: ${err.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

export const env = loadEnv();
export type Env = typeof env;
