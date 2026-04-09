// @ts-ignore - integration test imports package source files directly and uses a minimal browser harness in Node.
import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { createResourceManager, createServer, FakeDeviceProvider, LeaseManager } from "@listenai/resource-manager";
import type { DashboardSnapshot, InventorySnapshot } from "@listenai/contracts";
import { renderDashboardScript } from "../packages/resource-manager/src/server/dashboard-page.js";

const REFRESHED_AT = "2026-03-31T04:00:00.000Z";

const healthySnapshot: InventorySnapshot = {
  refreshedAt: REFRESHED_AT,
  inventoryScope: {
    providerKinds: ["dslogic"],
    backendKinds: ["dsview-cli"]
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
      backendKind: "dsview-cli",
      canonicalIdentity: {
        providerKind: "dslogic",
        providerDeviceId: "logic-ready",
        canonicalKey: "dslogic:logic-ready"
      },
      dslogic: {
        family: "dslogic",
        model: "dslogic-plus",
        modelDisplayName: "DSLogic Plus",
        variant: "classic",
        usbVendorId: "2a0e",
        usbProductId: "0001"
      }
    }
  ],
  backendReadiness: [
    {
      platform: "linux",
      backendKind: "dsview-cli",
      readiness: "ready",
      version: "dsview-cli 1.0.3",
      checkedAt: REFRESHED_AT,
      diagnostics: []
    }
  ],
  diagnostics: []
};

const backendDegradedSnapshot: InventorySnapshot = {
  refreshedAt: REFRESHED_AT,
  inventoryScope: {
    providerKinds: ["dslogic"],
    backendKinds: ["dsview-cli"]
  },
  devices: [
    {
      deviceId: "logic-slow-probe",
      label: "DSLogic Probe Slow",
      capabilityType: "logic-analyzer",
      connectionState: "connected",
      allocationState: "free",
      ownerSkillId: null,
      lastSeenAt: REFRESHED_AT,
      updatedAt: REFRESHED_AT,
      readiness: "degraded",
      diagnostics: [
        {
          code: "backend-runtime-timeout",
          severity: "warning",
          target: "device",
          message: "Capture path is slower than expected.",
          deviceId: "logic-slow-probe",
          backendKind: "dsview-cli"
        }
      ],
      providerKind: "dslogic",
      backendKind: "dsview-cli",
      canonicalIdentity: {
        providerKind: "dslogic",
        providerDeviceId: "logic-slow-probe",
        canonicalKey: "dslogic:logic-slow-probe"
      },
      dslogic: null
    }
  ],
  backendReadiness: [
    {
      platform: "linux",
      backendKind: "dsview-cli",
      readiness: "degraded",
      version: "dsview-cli 1.0.3",
      checkedAt: REFRESHED_AT,
      diagnostics: [
        {
          code: "backend-runtime-timeout",
          severity: "warning",
          target: "backend",
          message: "dsview-cli probe timed out before readiness was confirmed on linux.",
          platform: "linux",
          backendKind: "dsview-cli"
        }
      ]
    }
  ],
  diagnostics: [
    {
      code: "backend-runtime-timeout",
      severity: "warning",
      target: "backend",
      message: "dsview-cli probe timed out before readiness was confirmed on linux.",
      platform: "linux",
      backendKind: "dsview-cli"
    }
  ]
};

const backendMissingSnapshot: InventorySnapshot = {
  refreshedAt: REFRESHED_AT,
  inventoryScope: {
    providerKinds: ["dslogic"],
    backendKinds: ["dsview-cli"]
  },
  devices: [],
  backendReadiness: [
    {
      platform: "macos",
      backendKind: "dsview-cli",
      readiness: "missing",
      version: null,
      checkedAt: REFRESHED_AT,
      diagnostics: [
        {
          code: "backend-missing-runtime",
          severity: "error",
          target: "backend",
          message: "dsview-cli runtime is not available on macos.",
          platform: "macos",
          backendKind: "dsview-cli",
          backendVersion: null
        }
      ]
    }
  ],
  diagnostics: [
    {
      code: "backend-missing-runtime",
      severity: "error",
      target: "backend",
      message: "dsview-cli runtime is not available on macos.",
      platform: "macos",
      backendKind: "dsview-cli",
      backendVersion: null
    }
  ]
};

const unsupportedOnlySnapshot: InventorySnapshot = {
  refreshedAt: REFRESHED_AT,
  inventoryScope: {
    providerKinds: ["dslogic"],
    backendKinds: ["dsview-cli"]
  },
  devices: [
    {
      deviceId: "logic-pango",
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
          deviceId: "logic-pango",
          backendKind: "dsview-cli"
        }
      ],
      providerKind: "dslogic",
      backendKind: "dsview-cli",
      canonicalIdentity: {
        providerKind: "dslogic",
        providerDeviceId: "logic-pango",
        canonicalKey: "dslogic:logic-pango"
      },
      dslogic: {
        family: "dslogic",
        model: "dslogic-plus",
        modelDisplayName: "DSLogic Plus",
        variant: "v421-pango",
        usbVendorId: "2a0e",
        usbProductId: "0030"
      }
    }
  ],
  backendReadiness: [
    {
      platform: "linux",
      backendKind: "dsview-cli",
      readiness: "ready",
      version: "dsview-cli 1.0.3",
      checkedAt: REFRESHED_AT,
      diagnostics: []
    }
  ],
  diagnostics: [
    {
      code: "device-unsupported-variant",
      severity: "error",
      target: "device",
      message: "Variant V421/Pango (2a0e:0030) is not supported.",
      deviceId: "logic-pango",
      backendKind: "dsview-cli"
    }
  ]
};

class StubElement {
  textContent = "";
  innerHTML = "";
  disabled = false;
  readonly dataset: Record<string, string> = {};
  readonly #listeners = new Map<string, Array<() => void>>();

  addEventListener(type: string, listener: () => void): void {
    const listeners = this.#listeners.get(type) ?? [];
    listeners.push(listener);
    this.#listeners.set(type, listeners);
  }

  click(): void {
    for (const listener of this.#listeners.get("click") ?? []) {
      listener();
    }
  }
}

class StubDocument {
  readonly #elements: Map<string, StubElement>;

  constructor(elements: Map<string, StubElement>) {
    this.#elements = elements;
  }

  querySelector(selector: string): StubElement | null {
    return this.#elements.get(selector) ?? null;
  }
}

interface MessageEventLike {
  data: string;
}

class StubEventSource {
  readonly #url: string;
  readonly #fetchImpl: typeof fetch;
  readonly #listeners = new Map<string, Array<(event: MessageEventLike) => void>>();
  readonly #abortController = new AbortController();
  #closed = false;
  #reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  #buffer = "";
  #pumpPromise: Promise<void>;

  constructor(url: string, fetchImpl: typeof fetch) {
    this.#url = url;
    this.#fetchImpl = fetchImpl;
    this.#pumpPromise = this.#open();
  }

  addEventListener(type: string, listener: (event: MessageEventLike) => void): void {
    const listeners = this.#listeners.get(type) ?? [];
    listeners.push(listener);
    this.#listeners.set(type, listeners);
  }

  close(): void {
    this.#closed = true;
    this.#abortController.abort();
    void this.#reader?.cancel().catch(() => undefined);
  }

  async settled(): Promise<void> {
    await this.#pumpPromise.catch(() => undefined);
  }

  async #open(): Promise<void> {
    try {
      const response = await this.#fetchImpl(this.#url, {
        headers: { accept: "text/event-stream" },
        signal: this.#abortController.signal,
      });
      if (!response.ok || !response.body) {
        this.#emit("error", { data: JSON.stringify({ status: response.status }) });
        return;
      }

      this.#reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (!this.#closed) {
        const result = await this.#reader.read();
        if (result.done) {
          break;
        }

        this.#buffer += decoder.decode(result.value, { stream: true });
        this.#drainBuffer();
      }
    } catch {
      if (!this.#closed) {
        this.#emit("error", { data: JSON.stringify({ url: this.#url }) });
      }
    }
  }

  #drainBuffer(): void {
    while (true) {
      const separatorIndex = this.#buffer.indexOf("\n\n");
      if (separatorIndex < 0) {
        return;
      }

      const rawEvent = this.#buffer.slice(0, separatorIndex);
      this.#buffer = this.#buffer.slice(separatorIndex + 2);

      if (!rawEvent.trim() || rawEvent.startsWith(":")) {
        continue;
      }

      let eventName = "message";
      const dataLines: string[] = [];

      for (const line of rawEvent.split("\n")) {
        if (line.startsWith("event:")) {
          eventName = line.slice("event:".length).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice("data:".length).trim());
        }
      }

      if (dataLines.length === 0) {
        continue;
      }

      this.#emit(eventName, { data: dataLines.join("\n") });
    }
  }

  #emit(type: string, event: MessageEventLike): void {
    for (const listener of this.#listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

interface DashboardHarness {
  readonly elements: Record<string, StubElement>;
  close(): Promise<void>;
}

async function waitFor(assertion: () => void | Promise<void>, timeoutMs = 3000, intervalMs = 20): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt <= timeoutMs) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  throw lastError ?? new Error(`Condition not met within ${timeoutMs}ms`);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }
  return (await response.json()) as T;
}

function createElementMap(): Record<string, StubElement> {
  return {
    "#overview": new StubElement(),
    "#device-cards": new StubElement(),
    "#device-summary": new StubElement(),
    "#backend-readiness": new StubElement(),
    "#diagnostics": new StubElement(),
    "#refresh-button": new StubElement(),
    "#last-updated": new StubElement(),
    "#stream-status": new StubElement(),
    "#system-status-pill": new StubElement(),
    "#system-status-summary": new StubElement(),
    "#provider-summary": new StubElement(),
    "#backend-summary": new StubElement(),
  };
}

async function createDashboardHarness(baseUrl: string): Promise<DashboardHarness> {
  const elements = createElementMap();
  const elementMap = new Map(Object.entries(elements));
  const document = new StubDocument(elementMap);
  const eventSources = new Set<StubEventSource>();

  const fetchRelative: typeof fetch = (async (input, init) => {
    const url = typeof input === "string" || input instanceof URL ? new URL(String(input), baseUrl) : new URL(input.url, baseUrl);
    return fetch(url, init);
  }) as typeof fetch;

  const EventSource = class {
    readonly #inner: StubEventSource;

    constructor(path: string) {
      const inner = new StubEventSource(new URL(path, baseUrl).toString(), fetchRelative);
      this.#inner = inner;
      eventSources.add(inner);
    }

    addEventListener(type: string, listener: (event: MessageEventLike) => void): void {
      this.#inner.addEventListener(type, listener);
    }

    close(): void {
      this.#inner.close();
      eventSources.delete(this.#inner);
    }
  };

  const context = {
    document,
    window: undefined as unknown,
    fetch: fetchRelative,
    EventSource,
    console,
    setTimeout,
    clearTimeout,
  };
  context.window = context;

  runInNewContext(renderDashboardScript(), context, { filename: "dashboard.js" });

  return {
    elements,
    async close() {
      for (const source of [...eventSources]) {
        source.close();
        await source.settled();
      }
    },
  };
}

async function withDashboardServer(
  initialSnapshot: InventorySnapshot,
  run: (context: { url: string; provider: FakeDeviceProvider }) => Promise<void>,
): Promise<void> {
  const provider = new FakeDeviceProvider(initialSnapshot);
  const manager = createResourceManager(provider, { now: () => initialSnapshot.refreshedAt });
  await manager.refreshInventorySnapshot();
  const leaseManager = new LeaseManager({ timeoutMs: 30000 });
  const server = createServer({
    port: 0,
    host: "127.0.0.1",
    manager,
    leaseManager,
    scanIntervalMs: 15,
  });

  const { url } = await server.start();

  try {
    await run({ url, provider });
  } finally {
    server.stop();
  }
}

function expectHtmlToContain(element: StubElement, text: string): void {
  expect(element.innerHTML).toContain(text);
}

describe("resource-manager dashboard browser truth", () => {
  it("loads the healthy dashboard entrypoint and initial snapshot from the real server", async () => {
    await withDashboardServer(healthySnapshot, async ({ url }) => {
      const harness = await createDashboardHarness(url);

      try {
        await waitFor(() => {
          expect(harness.elements["#stream-status"].textContent).toBe("Live stream connected");
          expect(harness.elements["#stream-status"].dataset.state).toBe("connected");
          expect(harness.elements["#system-status-pill"].textContent).toBe("Healthy");
          expect(harness.elements["#system-status-pill"].dataset.state).toBe("healthy");
          expect(harness.elements["#provider-summary"].textContent).toBe("Provider dslogic");
          expect(harness.elements["#backend-summary"].textContent).toBe("Runtime dsview-cli");
          expect(harness.elements["#last-updated"].textContent).toMatch(/(Initial snapshot|Live initial) at/);
          expectHtmlToContain(harness.elements["#overview"], "Connected");
          expectHtmlToContain(harness.elements["#overview"], "Ready");
          expectHtmlToContain(harness.elements["#device-cards"], "DSLogic Plus Ready");
          expectHtmlToContain(harness.elements["#device-cards"], "available");
          expectHtmlToContain(harness.elements["#backend-readiness"], "dsview-cli 1.0.3");
          expect(harness.elements["#diagnostics"].innerHTML).toContain("No global diagnostics reported.");
        });

        const snapshot = await fetchJson<DashboardSnapshot>(`${url}/dashboard-snapshot`);
        expect(snapshot.overview).toMatchObject({
          totalDevices: 1,
          connectedDevices: 1,
          availableDevices: 1,
          activeLeases: 0,
          backendReady: 1,
          backendMissing: 0,
        });
      } finally {
        await harness.close();
      }
    });
  });

  it("surfaces degraded dsview-cli runtime truth without drifting back to a healthy posture", async () => {
    await withDashboardServer(healthySnapshot, async ({ url, provider }) => {
      const harness = await createDashboardHarness(url);

      try {
        await waitFor(() => {
          expect(harness.elements["#system-status-pill"].textContent).toBe("Healthy");
        });

        provider.setInventorySnapshot(backendDegradedSnapshot);
        const refreshed = await fetchJson<InventorySnapshot>(`${url}/inventory/refresh`, {
          method: "POST",
        });
        expect(refreshed.backendReadiness[0]?.readiness).toBe("degraded");

        await waitFor(async () => {
          const snapshot = await fetchJson<DashboardSnapshot>(`${url}/dashboard-snapshot`);
          expect(snapshot.overview).toMatchObject({
            totalDevices: 1,
            degradedDevices: 1,
            backendReady: 0,
            backendDegraded: 1,
          });
          expect(harness.elements["#system-status-pill"].dataset.state).toBe("attention");
          expect(harness.elements["#system-status-pill"].textContent).toBe("Attention needed");
          expect(harness.elements["#system-status-summary"].textContent).toContain(
            "device entry unavailable or abnormal"
          );
          expect(harness.elements["#backend-summary"].textContent).toBe("Runtime dsview-cli");
          expectHtmlToContain(harness.elements["#backend-readiness"], "backend-runtime-timeout");
          expectHtmlToContain(harness.elements["#backend-readiness"], "degraded");
          expectHtmlToContain(
            harness.elements["#diagnostics"],
            "dsview-cli probe timed out before readiness was confirmed on linux."
          );
          expect(harness.elements["#system-status-pill"].textContent).not.toBe("Healthy");
        });
      } finally {
        await harness.close();
      }
    });
  });

  it("keeps browser-visible allocation and release truth aligned with the API snapshot", async () => {
    await withDashboardServer(healthySnapshot, async ({ url }) => {
      const harness = await createDashboardHarness(url);

      try {
        await waitFor(() => {
          expect(harness.elements["#system-status-pill"].textContent).toBe("Healthy");
          expectHtmlToContain(harness.elements["#device-cards"], "available");
        });

        const allocateResponse = await fetchJson<{
          ok: boolean;
          leaseId: string;
        }>(`${url}/allocate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            deviceId: "logic-ready",
            ownerSkillId: "skill-live-browser",
            requestedAt: REFRESHED_AT,
          }),
        });
        expect(allocateResponse.ok).toBe(true);
        expect(allocateResponse.leaseId).toMatch(/[0-9a-f-]{36}/i);

        await waitFor(async () => {
          const snapshot = await fetchJson<DashboardSnapshot>(`${url}/dashboard-snapshot`);
          expect(snapshot.devices[0]).toMatchObject({
            deviceId: "logic-ready",
            allocationState: "allocated",
            occupancyState: "occupied",
            owner: { skillId: "skill-live-browser", source: "lease" },
            lease: { state: "active", leaseId: allocateResponse.leaseId },
          });
          expect(snapshot.overview).toMatchObject({ occupiedDevices: 1, activeLeases: 1, availableDevices: 0 });
          expectHtmlToContain(harness.elements["#device-cards"], "skill-live-browser");
          expectHtmlToContain(harness.elements["#device-cards"], "occupied");
          expectHtmlToContain(harness.elements["#device-cards"], allocateResponse.leaseId);
          expectHtmlToContain(harness.elements["#overview"], "Active leases");
          expect(harness.elements["#device-summary"].textContent).toContain("1 allocated");
        });

        const releaseResponse = await fetchJson<{ ok: boolean }>(`${url}/release`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            deviceId: "logic-ready",
            ownerSkillId: "skill-live-browser",
            releasedAt: "2026-03-31T04:00:30.000Z",
          }),
        });
        expect(releaseResponse.ok).toBe(true);

        await waitFor(async () => {
          const snapshot = await fetchJson<DashboardSnapshot>(`${url}/dashboard-snapshot`);
          expect(snapshot.devices[0]).toMatchObject({
            deviceId: "logic-ready",
            allocationState: "free",
            occupancyState: "available",
            owner: null,
            lease: { state: "none", leaseId: null },
          });
          expect(snapshot.overview).toMatchObject({ occupiedDevices: 0, activeLeases: 0, availableDevices: 1 });
          expectHtmlToContain(harness.elements["#device-cards"], "available");
          expect(harness.elements["#device-cards"].innerHTML).not.toContain("skill-live-browser");
          expect(harness.elements["#device-summary"].textContent).toContain("0 allocated");
        });
      } finally {
        await harness.close();
      }
    });
  });

  it("shows unsupported authoritative rows in the dashboard while compatibility routes stay empty", async () => {
    await withDashboardServer(healthySnapshot, async ({ url, provider }) => {
      const harness = await createDashboardHarness(url);

      try {
        await waitFor(() => {
          expect(harness.elements["#system-status-pill"].textContent).toBe("Healthy");
        });

        provider.setInventorySnapshot(unsupportedOnlySnapshot);
        const refreshed = await fetchJson<InventorySnapshot>(`${url}/inventory/refresh`, {
          method: "POST",
        });
        expect(refreshed.devices[0]?.readiness).toBe("unsupported");

        await waitFor(async () => {
          const snapshot = await fetchJson<DashboardSnapshot>(`${url}/dashboard-snapshot`);
          const compatibilityDevices = await fetchJson<InventorySnapshot["devices"]>(`${url}/devices`);
          const refreshedCompatibilityDevices = await fetchJson<InventorySnapshot["devices"]>(`${url}/refresh`, {
            method: "POST",
          });

          expect(snapshot.overview).toMatchObject({
            totalDevices: 1,
            readyDevices: 0,
            unsupportedDevices: 1,
            availableDevices: 1,
            backendReady: 1,
          });
          expect(snapshot.devices).toEqual([
            expect.objectContaining({
              deviceId: "logic-pango",
              readinessBadge: "unsupported",
              occupancyState: "available",
            }),
          ]);
          expect(compatibilityDevices).toEqual([]);
          expect(refreshedCompatibilityDevices).toEqual([]);
          expect(harness.elements["#system-status-pill"].dataset.state).toBe("attention");
          expect(harness.elements["#system-status-pill"].textContent).toBe("Attention needed");
          expect(harness.elements["#system-status-summary"].textContent).toContain(
            "device entry unavailable or abnormal"
          );
          expectHtmlToContain(harness.elements["#device-cards"], "DSLogic V421/Pango");
          expectHtmlToContain(harness.elements["#device-cards"], "unsupported");
          expect(harness.elements["#device-summary"].textContent).toContain("0 supported devices");
          expectHtmlToContain(
            harness.elements["#diagnostics"],
            "Variant V421/Pango (2a0e:0030) is not supported."
          );
        });
      } finally {
        await harness.close();
      }
    });
  });

  it("shows backend-missing degradation in the browser instead of a false healthy state", async () => {
    await withDashboardServer(healthySnapshot, async ({ url, provider }) => {
      const harness = await createDashboardHarness(url);

      try {
        await waitFor(() => {
          expect(harness.elements["#system-status-pill"].textContent).toBe("Healthy");
        });

        provider.setInventorySnapshot(backendMissingSnapshot);
        const refreshed = await fetchJson<InventorySnapshot>(`${url}/inventory/refresh`, {
          method: "POST",
        });
        expect(refreshed.backendReadiness[0]?.readiness).toBe("missing");

        await waitFor(async () => {
          const snapshot = await fetchJson<DashboardSnapshot>(`${url}/dashboard-snapshot`);
          expect(snapshot.overview).toMatchObject({
            totalDevices: 0,
            backendReady: 0,
            backendMissing: 1,
          });
          expect(harness.elements["#stream-status"].textContent).toBe("Live stream connected");
          expect(harness.elements["#system-status-pill"].dataset.state).toBe("error");
          expect(harness.elements["#system-status-pill"].textContent).toBe("Runtime attention required");
          expect(harness.elements["#system-status-summary"].textContent).toContain("dsview-cli runtime blockers");
          expectHtmlToContain(harness.elements["#backend-readiness"], "backend-missing-runtime");
          expectHtmlToContain(harness.elements["#backend-readiness"], "missing");
          expectHtmlToContain(harness.elements["#diagnostics"], "dsview-cli runtime is not available on macos.");
          expect(harness.elements["#device-summary"].textContent).toContain("0 supported devices");
          expect(harness.elements["#system-status-pill"].textContent).not.toBe("Healthy");
        });
      } finally {
        await harness.close();
      }
    });
  });
});
