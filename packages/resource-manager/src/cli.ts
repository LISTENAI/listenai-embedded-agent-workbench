#!/usr/bin/env node

import { parseArgs } from "node:util"
import type { InventorySnapshot } from "@listenai/eaw-contracts"
import { InMemoryResourceManager } from "./resource-manager.js"
import { createServer } from "./server/server.js"
import { LeaseManager } from "./server/lease-manager.js"
import { createDeviceProvider } from "./dslogic/provider-factory.js"
import {
  createDefaultDslogicNativeCaptureDecodeBackend,
  createDefaultDslogicNativeDecoderCapabilitiesBackend,
  createDefaultDslogicNativeDeviceOptionsBackend,
  createDefaultDslogicNativeLiveCaptureBackend
} from "./dslogic/native-runtime.js"
import {
  getDaemonStatus,
  startDaemon,
  stopDaemon,
  type ResourceManagerDaemonStatus
} from "./daemon.js"

interface RuntimeOptions {
  command: "start" | "status" | "stop"
  port: number
  host: string
  providerKind: "fake" | "dslogic"
  inventoryPollIntervalMs?: number
  leaseScanIntervalMs?: number
  dsviewCliPath?: string
  dsviewResourceDir?: string
  daemon: boolean
  daemonChild: boolean
  json: boolean
  stateDir?: string
  logFile?: string
  readyTimeoutMs?: number
}

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

const parseOptionalPath = (rawValue: string | undefined): string | undefined => {
  const trimmed = rawValue?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : undefined
}

const parseOptionalTimeoutMs = (rawValue: string | undefined): number | undefined => {
  if (!rawValue) return undefined
  const parsed = Number.parseInt(rawValue, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`readyTimeoutMs must be a positive integer in milliseconds, received ${rawValue}`)
  }
  return parsed
}

function parseRuntimeOptions(): RuntimeOptions {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
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
      },
      dsviewCliPath: {
        type: "string",
        default: process.env.RESOURCE_MANAGER_DSVIEW_CLI_PATH
      },
      dsviewResourceDir: {
        type: "string",
        default: process.env.RESOURCE_MANAGER_DSVIEW_RESOURCE_DIR
      },
      daemon: {
        type: "boolean",
        default: false
      },
      "daemon-child": {
        type: "boolean",
        default: false
      },
      json: {
        type: "boolean",
        default: false
      },
      "state-dir": {
        type: "string",
        default: process.env.RESOURCE_MANAGER_STATE_DIR
      },
      "log-file": {
        type: "string",
        default: process.env.RESOURCE_MANAGER_LOG_FILE
      },
      readyTimeoutMs: {
        type: "string",
        default: process.env.RESOURCE_MANAGER_READY_TIMEOUT_MS
      }
    }
  })

  const first = positionals[0]
  if (first && first !== "status" && first !== "stop" && first !== "start") {
    throw new Error(`Unknown command '${first}'. Expected start, status, or stop.`)
  }
  const command = first === "status" || first === "stop" || first === "start" ? first : "start"
  const port = parseInt(values.port || "7600", 10)
  if (!Number.isFinite(port) || port < 0) {
    throw new Error(`port must be a non-negative integer, received ${values.port}`)
  }

  return {
    command,
    port,
    host: values.host || "0.0.0.0",
    providerKind: values.provider === "fake" ? "fake" : "dslogic",
    inventoryPollIntervalMs: parseOptionalIntervalMs(
      values.inventoryPollIntervalMs,
      "inventoryPollIntervalMs"
    ),
    leaseScanIntervalMs: parseOptionalIntervalMs(
      values.leaseScanIntervalMs,
      "leaseScanIntervalMs"
    ),
    dsviewCliPath: parseOptionalPath(values.dsviewCliPath),
    dsviewResourceDir: parseOptionalPath(values.dsviewResourceDir),
    daemon: values.daemon === true,
    daemonChild: values["daemon-child"] === true,
    json: values.json === true,
    stateDir: parseOptionalPath(values["state-dir"]),
    logFile: parseOptionalPath(values["log-file"]),
    readyTimeoutMs: parseOptionalTimeoutMs(values.readyTimeoutMs)
  }
}

function createRuntimeArgs(options: RuntimeOptions): string[] {
  const args = [
    "--host", options.host,
    "--port", String(options.port),
    "--provider", options.providerKind
  ]

  if (options.inventoryPollIntervalMs) {
    args.push("--inventoryPollIntervalMs", String(options.inventoryPollIntervalMs))
  }
  if (options.leaseScanIntervalMs) {
    args.push("--leaseScanIntervalMs", String(options.leaseScanIntervalMs))
  }
  if (options.dsviewCliPath) {
    args.push("--dsviewCliPath", options.dsviewCliPath)
  }
  if (options.dsviewResourceDir) {
    args.push("--dsviewResourceDir", options.dsviewResourceDir)
  }

  return args
}

function printStatus(status: ResourceManagerDaemonStatus, json: boolean) {
  if (json) {
    console.log(JSON.stringify(status))
    return
  }

  console.log(status.message)
  if (status.url) {
    console.log(`URL: ${status.url}`)
  }
  if (status.pid) {
    console.log(`PID: ${status.pid}`)
  }
  console.log(`State: ${status.stateFile}`)
  if (status.logFile) {
    console.log(`Log: ${status.logFile}`)
  }
}

async function startForeground(options: RuntimeOptions) {
  const providerKind = options.providerKind
  const fakeInventory = providerKind === "fake" ? parseFakeInventorySnapshot() : undefined

  const provider = createDeviceProvider({
    providerKind,
    fakeInventory,
    dslogic:
      providerKind === "dslogic"
        ? {
            deviceOptionsRunner: createDefaultDslogicNativeDeviceOptionsBackend({
              dsviewCliPath: options.dsviewCliPath
            }),
            decoderCapabilitiesRunner: createDefaultDslogicNativeDecoderCapabilitiesBackend({
              dsviewCliPath: options.dsviewCliPath
            }),
            captureDecodeRunner: createDefaultDslogicNativeCaptureDecodeBackend({
              dsviewCliPath: options.dsviewCliPath,
              dsviewResourceDir: options.dsviewResourceDir
            }),
            liveCaptureRunner: createDefaultDslogicNativeLiveCaptureBackend({
              dsviewCliPath: options.dsviewCliPath,
              dsviewResourceDir: options.dsviewResourceDir
            })
          }
        : undefined
  })
  const manager = new InMemoryResourceManager(provider)
  const leaseManager = new LeaseManager()

  const { start, stop } = createServer({
    port: options.port,
    host: options.host,
    manager,
    leaseManager,
    inventoryPollIntervalMs: options.inventoryPollIntervalMs,
    leaseScanIntervalMs: options.leaseScanIntervalMs
  })

  await start()

  process.on("SIGINT", () => {
    console.log("SIGINT received, stopping server...")
    stop()
    process.exit(0)
  })

  process.on("SIGTERM", () => {
    console.log("SIGTERM received, stopping server...")
    stop()
    process.exit(0)
  })
}

async function main() {
  const options = parseRuntimeOptions()

  if (options.command === "status") {
    printStatus(await getDaemonStatus({ stateDir: options.stateDir }), options.json)
    return
  }

  if (options.command === "stop") {
    printStatus(await stopDaemon({ stateDir: options.stateDir }), options.json)
    return
  }

  if (options.daemon && !options.daemonChild) {
    const status = await startDaemon({
      cliPath: process.argv[1],
      execArgv: process.execArgv,
      host: options.host,
      port: options.port,
      provider: options.providerKind,
      args: createRuntimeArgs(options),
      stateDir: options.stateDir,
      logFile: options.logFile,
      readyTimeoutMs: options.readyTimeoutMs
    })
    printStatus(status, options.json)
    return
  }

  await startForeground(options)
}

main().catch((error) => {
  console.error("resource-manager failed:", error)
  process.exit(1)
})
