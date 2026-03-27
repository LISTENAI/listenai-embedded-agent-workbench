#!/usr/bin/env node

import { parseArgs } from "node:util";
import { createServer } from "./server.js";
import { InMemoryResourceManager } from "../resource-manager.js";
import { FakeDeviceProvider } from "../testing/fake-device-provider.js";
import { LeaseManager } from "./lease-manager.js";

async function main() {
  const { values } = parseArgs({
    options: {
      port: {
        type: "string",
        short: "p",
        default: "7600",
      },
      host: {
        type: "string",
        short: "h",
        default: "127.0.0.1",
      },
    },
  });

  const port = parseInt(values.port || "7600", 10);
  const host = values.host || "127.0.0.1";

  // TODO: Replace with real provider in S03
  const provider = new FakeDeviceProvider();
  const manager = new InMemoryResourceManager(provider);
  const leaseManager = new LeaseManager();

  const { start, stop } = createServer({ port, host, manager, leaseManager });

  start();

  process.on("SIGINT", async () => {
    console.log("SIGINT received, stopping server...");
    stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("SIGTERM received, stopping server...");
    stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Server failed to start:", err);
  process.exit(1);
});
