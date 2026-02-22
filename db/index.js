import { openDb as openMockDb } from "./adapters/mock.js";
import { openDb as openSupabaseDb } from "./adapters/supabase.js";
import { seedDatabase } from "./seed.js";

function shouldLogDbAdapter() {
	return process.env.ENABLE_DB_ADAPTER_LOGS === "true";
}

async function openDb(options = {}) {
  const { quiet = false } = options;
  const log = quiet || !shouldLogDbAdapter() ? () => {} : console.log;

  // Determine which adapter to use based on environment
  // On Vercel, prefer Supabase if credentials are available, otherwise use mock
  if (process.env.VERCEL) {
    // Check if Supabase credentials are available
    if (process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
      log("Using Supabase adapter for Vercel deployment.");
      return openSupabaseDb();
    } else {
      log("Using mock database for Vercel deployment (Supabase credentials not found).");
      const dbInstance = openMockDb();
      await seedDatabase(dbInstance);
      return dbInstance;
    }
  }

  // Use DB_ADAPTER environment variable to switch adapters
  // Default to sqlite if not specified
  const adapter = process.env.DB_ADAPTER || "sqlite";

  switch (adapter) {
    case "supabase":
      log("Using Supabase adapter.");
      return openSupabaseDb();
    case "mock":
      log("Using mock database adapter.");
      {
        const dbInstance = openMockDb();
        await seedDatabase(dbInstance);
        return dbInstance;
      }
    case "sqlite":
    default:
      log("Using SQLite adapter.");
      // Dynamically import SQLite adapter only when needed (not in production/Vercel)
      const { openDb: openSqliteDb } = await import("./adapters/sqlite.js");
      return openSqliteDb();
  }
}

export { openDb };

