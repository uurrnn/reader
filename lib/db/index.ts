import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";
import { requiredEnv } from "@/lib/env";

export const db = drizzle(neon(requiredEnv("DATABASE_URL")), { schema });
