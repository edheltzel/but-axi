#!/usr/bin/env node
import { main } from "../src/cli.js";

process.stdout.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EPIPE") process.exit(0);
  throw e;
});

const { stdout, exitCode } = await main(process.argv.slice(2));
process.stdout.write(stdout, () => process.exit(exitCode));
