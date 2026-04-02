#!/usr/bin/env node

import { parseArgs } from "node:util"
import type { InventorySnapshot } from "@listenai/contracts"
import { InMemoryResourceManager } from "./resource-manager.js"
import { createServer } from "./server/server.js"
import { LeaseManager } from "./server/lease-manager.js"
import { createDeviceProvider } from "./dslogic/provider-factory.js"

const parseFakeInventorySnapshot = (): InventorySnapshot | undefined => {
  const rawSnapshot = process.env.RESOURCE_MANAGER_FAKE_INVENTORY_SNAPSHOT

  if (!rawSnapshot) {
    return undefined
  }

  try {
    return JSON.parse(rawSnapshot) as InventorySnapshot
  } catch (error) {
    throw new Error(
      `RESOURCE_MANAGER_FAKE_INVENTORY_SNAPSHOT must be valid JSON: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      port: {
        type: "string",
        short: "p",
        default: "7600"
      },
      host: {
        type: "string",
        short: "h",
        default: "0.0.0.0"
      },
      provider: {
        type: "string",
        default: process.env.RESOURCE_MANAGER_PROVIDER ?? "dslogic"
      }
    }
  })

  const port = parseInt(values.port || "7600", 10)
  const host = values.host || "0.0.0.0"
  const providerKind = values.provider === "fake" ? "fake" : "dslogic"
  const fakeInventory = providerKind === "fake" ? parseFakeInventorySnapshot() : undefined

  const provider = createDeviceProvider({ providerKind, fakeInventory })
  const manager = new InMemoryResourceManager(provider)
  const leaseManager = new LeaseManager()

  const { start, stop } = createServer({ port, host, manager, leaseManager })

  await start()

  process.on("SIGINT", async () => {
    console.log("SIGINT received, stopping server...")
    stop()
    process.exit(0)
  })

  process.on("SIGTERM", async () => {
    console.log("SIGTERM received, stopping server...")
    stop()
    process.exit(0)
  })
}

main().catch((error) => {
  console.error("Server failed to start:", error)
  process.exit(1)
})
