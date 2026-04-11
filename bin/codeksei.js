#!/usr/bin/env node

const { main } = require("../src/index");
const { PACKAGE_NAME } = require("../src/core/branding");

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[${PACKAGE_NAME}] ${message}`);
  process.exitCode = 1;
});
