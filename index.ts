import "./src/env";
import { runCli } from "./src/cli";

runCli().catch((error) => {
  console.error("CLI failed:", error);
  process.exit(1);
});