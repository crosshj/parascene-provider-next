// Load environment variables from .env file
import 'dotenv/config';

// Safety: prevent automated tests from writing to Supabase by default.
//
// To explicitly allow Supabase/integration tests, set:
//   RUN_INTEGRATION_TESTS=true
//
// This keeps `npm test` side-effect free even if SUPABASE_* env vars are present.
const allowIntegration = String(process.env.RUN_INTEGRATION_TESTS || '').toLowerCase() === 'true';
if (!allowIntegration) {
	// Force local adapter for any code that uses openDb().
	process.env.DB_ADAPTER = 'sqlite';
	// Remove Supabase credentials so accidental adapter usage fails fast.
	delete process.env.SUPABASE_URL;
	delete process.env.SUPABASE_ANON_KEY;
	delete process.env.SUPABASE_SERVICE_ROLE_KEY;
}
