// @ts-ignore - integration test imports package source files directly and runs the shipped CLI through tsx.
import { afterEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { DashboardSnapshot, DeviceRecord, InventorySnapshot } from "@listenai/contracts";

const WORKTREE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const TSX_LOADER_PATH = fileURLToPath(new URL("../node_modules/tsx/dist/loader.mjs", import.meta.url));
const CLI_PATH = fileURLToPath(new URL("../packages/resource-manager/src/cli.ts", import.meta.url));
const REFRESHED_AT = "2026-03-31T06:00:00.000Z";

const packagedSnapshot: InventorySnapshot = {
  refreshedAt: REFRESHED_AT,
  inventoryScope: {
    providerKinds: ["dslogic"],
    backendKinds: ["libsigrok"],
  },
  devices: [
    {
      deviceId: "logic-ready",
      label: "DSLogic Plus Ready",
      capabilityType: "logic-analyzer",
      connectionState: "connected",
      allocationState: "free",
      ownerSkillId: null,
      lastSeenAt: REFRESHED_AT,
      updatedAt: REFRESHED_AT,
      readiness: "ready",
      diagnostics: [],
      providerKind: "dslogic",
      backendKind: "libsigrok",
      canonicalIdentity: {
        providerKind: "dslogic",
        providerDeviceId: "logic-ready",
        canonicalKey: "dslogic:logic-ready",
      },
      dslogic: {
        family: "dslogic",
        model: "dslogic-plus",
        modelDisplayName: "DSLogic Plus",
        variant: "classic",
        usbVendorId: "2a0e",
        usbProductId: "0001",
      },
    },
    {
      deviceId: "logic-unsupported",
      label: "DSLogic V421/Pango",
      capabilityType: "logic-analyzer",
      connectionState: "connected",
      allocationState: "free",
      ownerSkillId: null,
      lastSeenAt: REFRESHED_AT,
      updatedAt: REFRESHED_AT,
      readiness: "unsupported",
      diagnostics: [
        {
          code: "device-unsupported-variant",
          severity: "error",
          target: "device",
          message: "Variant V421/Pango (2a0e:0030) is not supported.",
          deviceId: "logic-unsupported",
          backendKind: "libsigrok",
        },
      ],
      providerKind: "dslogic",
      backendKind: "libsigrok",
      canonicalIdentity: {
        providerKind: "dslogic",
        providerDeviceId: "logic-unsupported",
        canonicalKey: "dslogic:logic-unsupported",
      },
      dslogic: {
        family: "dslogic",
        model: "dslogic-plus",
        modelDisplayName: "DSLogic Plus",
        variant: "v421-pango",
        usbVendorId: "2a0e",
        usbProductId: "0030",
      },
    },
  ],
  backendReadiness: [
    {
      platform: "macos",
      backendKind: "libsigrok",
      readiness: "ready",
      version: "libsigrok 0.6.0",
      checkedAt: REFRESHED_AT,
      diagnostics: [],
    },
  ],
  diagnostics: [
    {
      code: "device-unsupported-variant",
      severity: "error",
      target: "device",
      message: "Variant V421/Pango (2a0e:0030) is not supported.",
      deviceId: "logic-unsupported",
      backendKind: "libsigrok",
    },
  ],
};

interface StartedCli {
  child: ChildProcess;
  url: string;
  stop: () => Promise<void>;
  getStdout: () => string;
  getStderr: () => string;
}

const activeChildren = new Set<StartedCli>();

afterEach(async () => {
  await Promise.all([...activeChildren].map(async (processHandle) => processHandle.stop()));
  activeChildren.clear();
});

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }
  return (await response.json()) as T;
}

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }
  return await response.text();
}

function normalizeInventorySnapshot(snapshot: InventorySnapshot): InventorySnapshot {
  const refreshedAt = snapshot.refreshedAt;

  return {
    ...packagedSnapshot,
    refreshedAt,
    devices: packagedSnapshot.devices.map((device) => {
      const observed = snapshot.devices.find((candidate) => candidate.deviceId === device.deviceId);
      return {
        ...device,
        updatedAt: observed?.updatedAt ?? device.updatedAt,
      };
    }),
  };
}

async function readInitialDashboardEvent(url: string): Promise<DashboardSnapshot> {
  const abortController = new AbortController();
  const response = await fetch(`${url}/dashboard-events`, {
    headers: { accept: "text/event-stream" },
    signal: abortController.signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`SSE request failed for ${url}/dashboard-events: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) {
        break;
      }

      buffer += decoder.decode(result.value, { stream: true });

      while (true) {
        const separatorIndex = buffer.indexOf("\n\n");
        if (separatorIndex < 0) {
          break;
        }

        const rawEvent = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex + 2);
        const dataLines = rawEvent
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice("data:".length).trim());

        if (rawEvent.includes("event: snapshot") && dataLines.length > 0) {
          const payload = JSON.parse(dataLines.join("\n")) as {
            snapshot: DashboardSnapshot;
          };
          abortController.abort();
          return payload.snapshot;
        }
      }
    }
  } finally {
    abortController.abort();
    reader.releaseLock();
  }

  throw new Error("No snapshot event was published by /dashboard-events");
}

function startCli(snapshot: InventorySnapshot): Promise<StartedCli> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", TSX_LOADER_PATH, CLI_PATH, "--port", "0", "--host", "127.0.0.1", "--provider", "fake"], {
      cwd: WORKTREE_ROOT,
      env: {
        ...process.env,
        RESOURCE_MANAGER_FAKE_INVENTORY_SNAPSHOT: JSON.stringify(snapshot),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const startupTimeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGTERM");
        reject(new Error(`CLI startup timed out. stdout=${stdout} stderr=${stderr}`));
      }
    }, 4000);

    const finishResolve = (url: string) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(startupTimeout);

      const stop = async () => {
        if (child.exitCode !== null || child.killed) {
          return;
        }

        await new Promise<void>((stopResolve) => {
          child.once("close", () => stopResolve());
          child.kill("SIGTERM");
        });
      };

      const processHandle: StartedCli = {
        child,
        url,
        stop,
        getStdout: () => stdout,
        getStderr: () => stderr,
      };

      activeChildren.add(processHandle);
      resolve(processHandle);
    };

    const finishReject = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(startupTimeout);
      reject(error);
    };

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      const match = stdout.match(/Server listening on (http:\/\/[^\s]+)/);
      if (match?.[1]) {
        finishResolve(match[1]);
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.once("error", (error) => {
      finishReject(error instanceof Error ? error : new Error(String(error)));
    });

    child.once("close", (code) => {
      if (!settled) {
        finishReject(new Error(`CLI exited before startup with code ${code}. stdout=${stdout} stderr=${stderr}`));
      }
    });
  });
}

describe("resource-manager packaged CLI", () => {
  it("starts the shipped entrypoint and keeps HTTP, SSE, and compatibility routes aligned", async () => {
    const cli = await startCli(packagedSnapshot);

    try {
      const html = await fetchText(`${cli.url}/`);
      expect(html).toContain("ListenAI Resource Manager");
      expect(html).toContain("/dashboard.js");

      const inventory = await fetchJson<InventorySnapshot>(`${cli.url}/inventory`);
      expect(inventory).toEqual(normalizeInventorySnapshot(inventory));

      const dashboardSnapshot = await fetchJson<DashboardSnapshot>(`${cli.url}/dashboard-snapshot`);
      expect(dashboardSnapshot.overview).toMatchObject({
        totalDevices: 2,
        connectedDevices: 2,
        availableDevices: 2,
        readyDevices: 1,
        unsupportedDevices: 1,
        backendReady: 1,
      });
      expect(dashboardSnapshot.devices).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            deviceId: "logic-ready",
            readinessBadge: "ready",
            occupancyState: "available",
          }),
          expect.objectContaining({
            deviceId: "logic-unsupported",
            readinessBadge: "unsupported",
            occupancyState: "available",
          }),
        ]),
      );

      const sseSnapshot = await readInitialDashboardEvent(cli.url);
      expect(sseSnapshot).toEqual(dashboardSnapshot);

      const compatibilityDevices = await fetchJson<DeviceRecord[]>(`${cli.url}/devices`);
      expect(compatibilityDevices).toEqual([
        expect.objectContaining({
          deviceId: "logic-ready",
          readiness: "ready",
          providerKind: "dslogic",
          backendKind: "libsigrok",
        }),
      ]);

      const refreshedCompatibilityDevices = await fetchJson<DeviceRecord[]>(`${cli.url}/refresh`, {
        method: "POST",
      });
      expect(refreshedCompatibilityDevices).toEqual([
        expect.objectContaining({
          deviceId: "logic-ready",
          readiness: "ready",
          providerKind: "dslogic",
          backendKind: "libsigrok",
        }),
      ]);

      expect(cli.getStdout()).toContain(`Server listening on ${cli.url}`);
      expect(cli.getStderr()).toBe("");
    } finally {
      await cli.stop();
      activeChildren.delete(cli);
    }
  }, 10000);
});
