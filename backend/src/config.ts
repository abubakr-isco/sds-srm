// Reads and validates environment variables once. Secrets come only from the environment.
export interface AppConfig {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  jwtSecret: string;
  accessTokenTtlSeconds: number;
  refreshTokenTtlDays: number;
  corsOrigins: string[];
  companyTimezone: string;
  loginMaxFailedAttempts: number;
  loginLockMinutes: number;
  authRateLimitPerMinute: number;
  apiRateLimitPerMinute: number;
  enableTestData: boolean;
  testDataPassword: string;
}

function int(name: string, fallback: number, min = 1): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) throw new Error(`Environment variable ${name} must be an integer >= ${min}.`);
  return value;
}

export function loadConfig(): AppConfig {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
  const jwtSecret = process.env.JWT_SECRET || '';
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET is required and must be at least 32 characters.');
  if (isProduction && /replace-with/i.test(jwtSecret)) throw new Error('JWT_SECRET still has the example value.');
  const companyTimezone = process.env.COMPANY_TIMEZONE || 'America/Chicago';
  try { new Intl.DateTimeFormat('en-US', { timeZone: companyTimezone }); } catch {
    throw new Error(`COMPANY_TIMEZONE "${companyTimezone}" is not a valid IANA time zone.`);
  }
  const enableTestData = !isProduction && process.env.ENABLE_TEST_DATA === 'true';
  const testDataPassword = process.env.TEST_DATA_PASSWORD || '';
  if (enableTestData && testDataPassword.length < 8) throw new Error('TEST_DATA_PASSWORD (min 8 chars) is required when ENABLE_TEST_DATA=true.');
  return {
    nodeEnv,
    isProduction,
    port: int('PORT', 3000),
    jwtSecret,
    accessTokenTtlSeconds: int('ACCESS_TOKEN_TTL_SECONDS', 3600, 60),
    refreshTokenTtlDays: int('REFRESH_TOKEN_TTL_DAYS', 30),
    corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
    companyTimezone,
    loginMaxFailedAttempts: int('LOGIN_MAX_FAILED_ATTEMPTS', 5),
    loginLockMinutes: int('LOGIN_LOCK_MINUTES', 15),
    authRateLimitPerMinute: int('AUTH_RATE_LIMIT_PER_MINUTE', 20),
    apiRateLimitPerMinute: int('API_RATE_LIMIT_PER_MINUTE', 600),
    enableTestData,
    testDataPassword,
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
