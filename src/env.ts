import { config } from "dotenv";

// Load .env.local first (if present), then .env
config({ path: ".env.local", override: false });
config();
