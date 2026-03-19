/**
 * Load root `.env` when running `npm run dev` from `services/ai-service` (Node does not auto-load .env).
 * Docker / compose inject env — these calls are no-ops if variables already exist (dotenv does not override by default).
 */
import path from 'path';
import { config as loadEnv } from 'dotenv';

loadEnv();
loadEnv({ path: path.resolve(process.cwd(), '../../.env') });
