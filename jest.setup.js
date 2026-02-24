// Load environment variables from .env.local
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local', override: true });

// Bridge ESM tests to global jest helper so we don't need explicit imports
import { jest as jestGlobals } from '@jest/globals';
globalThis.jest = jestGlobals;
