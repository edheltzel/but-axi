#!/usr/bin/env node
import { isBareVersion, VERSION } from "../src/version.js";

process.stdout.on("error", (e: NodeJS.ErrnoException) => {
  if (e.code === "EPIPE") process.exit(0);
  throw e;
});

const argv = process.argv.slice(2);
if (isBareVersion(argv)) {
  process.stdout.write(`${VERSION}\n`, () => process.exit(0));
} else {
  const { main } = await import("../src/cli.js");
  const { stdout, exitCode } = await main(argv);
  process.stdout.write(stdout, () => process.exit(exitCode));
}
