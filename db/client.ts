import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("Missing required environment variable: DATABASE_URL");
}

function shouldUseSsl(connectionString: string) {
  return connectionString.includes("railway.internal") || connectionString.includes("proxy.rlwy.net");
}

export const pool = new Pool({
  connectionString: databaseUrl,
  ssl: shouldUseSsl(databaseUrl) ? { rejectUnauthorized: false } : undefined,
});

export const db = drizzle(pool, { schema });

export { schema };
