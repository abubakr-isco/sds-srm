import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Loads backend/.env for local runs. Variables already set in the environment win.
const file = resolve(__dirname, '..', '.env');
if (existsSync(file)) process.loadEnvFile(file);
