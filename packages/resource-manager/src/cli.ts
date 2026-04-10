#!/usr/bin/env node

import { parseArgs } from "node:util"
import type { InventorySnapshot } from "@listenai/contracts"
import { InMemoryResourceManager } from "./resource-manager.js"
import { createServer } from "./server/server.js"
import { LeaseManager } from "./server/lease-manager.js"
import { createDeviceProvider } from "./dslogic/provider-factory.js"
import { createDefaultDslogicNativeLiveCaptureBackend } from "./dslogic/native-runtime.js"

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

const parseOptionalIntervalMs = (rawValue: string | undefined, name: string): number | undefined => {
  if (!rawValue) {
    return undefined
  }

  const parsed = Number.parseInt(rawValue, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer in milliseconds, received ${rawValue}`)
  }

  return parsed
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
      },
      inventoryPollIntervalMs: {
        type: "string",
        default: process.env.RESOURCE_MANAGER_INVENTORY_POLL_INTERVAL_MS
      },
      leaseScanIntervalMs: {
        type: "string",
        default: process.env.RESOURCE_MANAGER_LEASE_SCAN_INTERVAL_MS
      }
    }
  })

  const port = parseInt(values.port || "7600", 10)
  const host = values.host || "0.0.0.0"
  const providerKind = values.provider === "fake" ? "fake" : "dslogic"
  const fakeInventory = providerKind === "fake" ? parseFakeInventorySnapshot() : undefined
  const inventoryPollIntervalMs = parseOptionalIntervalMs(
    values.inventoryPollIntervalMs,
    "inventoryPollIntervalMs"
  )
  const leaseScanIntervalMs = parseOptionalIntervalMs(
    values.leaseScanIntervalMs,
    "leaseScanIntervalMs"
  )

  const provider = createDeviceProvider({
    providerKind,
    fakeInventory,
    dslogic:
      providerKind === "dslogic"
        ? { liveCaptureRunner: createDefaultDslogicNativeLiveCaptureBackend() }
        : undefined
  })
  const manager = new InMemoryResourceManager(provider)
  const leaseManager = new LeaseManager()

  const { start, stop } = createServer({
    port,
    host,
    manager,
    leaseManager,
    inventoryPollIntervalMs,
    leaseScanIntervalMs,
  })

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
