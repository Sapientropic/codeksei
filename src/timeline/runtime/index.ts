import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { readConfig } from "../../core/config";
import { loadEnvStack } from "../../core/env-loader";
import { main as runTimelineCli } from "../index";

function ensureDefaultConfigDirectory(): void {
  const defaultConfigDir = path.join(os.homedir(), ".codeksei");
  fs.mkdirSync(defaultConfigDir, { recursive: true });
}

async function main(argv: string[] = process.argv): Promise<void> {
  ensureDefaultConfigDirectory();
  loadEnvStack({ cwd: process.cwd() });
  await runTimelineCli(argv, readConfig());
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack || error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}

export {
  main,
};
