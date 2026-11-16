// Test environment. Tests run against TEST_DATABASE_URL, a database whose name must end in "_test".
const url = process.env.TEST_DATABASE_URL || 'postgresql://sds:sds_local_password@localhost:5432/sds_crm_test?schema=public';
process.env.DATABASE_URL = url;
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-0123456789';
process.env.COMPANY_TIMEZONE = 'America/Chicago';
process.env.LOGIN_MAX_FAILED_ATTEMPTS = '3';
process.env.LOGIN_LOCK_MINUTES = '15';
process.env.AUTH_RATE_LIMIT_PER_MINUTE = process.env.AUTH_RATE_LIMIT_PER_MINUTE || '1000';
process.env.ENABLE_TEST_DATA = 'true';
process.env.TEST_DATA_PASSWORD = 'TestData2026!';
process.env.CORS_ORIGINS = '';
