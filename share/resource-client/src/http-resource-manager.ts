import type {
  AllocationFailure,
  AllocationRequest,
  AllocationResult,
  AllocationSuccessWithLease,
  DeviceRecord,
  ReleaseFailure,
  ReleaseRequest,
  ReleaseResult,
  ResourceManager,
} from "@listenai/contracts";

export class HttpResourceManager implements ResourceManager {
  readonly #baseUrl: string;
  readonly #leases = new Map<string, string>();
  readonly #heartbeatTimers = new Map<string, NodeJS.Timeout>();

  constructor(baseUrl: string) {
    this.#baseUrl = baseUrl;
  }

  async listDevices(): Promise<readonly DeviceRecord[]> {
    const res = await this.#fetch(`${this.#baseUrl}/devices`);
    return (await res.json()) as DeviceRecord[];
  }

  async refreshInventory(): Promise<readonly DeviceRecord[]> {
    const res = await this.#fetch(`${this.#baseUrl}/refresh`, {
      method: "POST",
    });
    return (await res.json()) as DeviceRecord[];
  }

  async allocateDevice(
    request: AllocationRequest,
  ): Promise<AllocationResult> {
    let res: Response;
    try {
      res = await fetch(`${this.#baseUrl}/allocate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
    } catch {
      return this.#allocationServerUnavailable(request, "Server unavailable");
    }

    if (!res.ok) {
      const body = (await res.json()) as AllocationResult;
      if (!body.ok) {
        return body;
      }

      return this.#allocationServerUnavailable(
        request,
        `Server returned ${res.status}`,
      );
    }

    const body = (await res.json()) as AllocationSuccessWithLease;
    this.#leases.set(request.deviceId, body.leaseId);

    const timer = setInterval(async () => {
      try {
        const heartbeatRes = await fetch(`${this.#baseUrl}/heartbeat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leaseId: body.leaseId }),
        });

        if (!heartbeatRes.ok) {
          console.error(
            `Heartbeat failed for lease ${body.leaseId}: ${heartbeatRes.status}`,
          );
        }
      } catch (err) {
        console.error(`Heartbeat failed for lease ${body.leaseId}:`, err);
      }
    }, 30000);

    this.#heartbeatTimers.set(request.deviceId, timer);
    return { ok: true, device: body.device };
  }

  async releaseDevice(request: ReleaseRequest): Promise<ReleaseResult> {
    let res: Response;
    try {
      res = await fetch(`${this.#baseUrl}/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
    } catch {
      return this.#releaseServerUnavailable(request, "Server unavailable");
    }

    const body = (await res.json()) as ReleaseResult;
    if (body.ok) {
      this.#leases.delete(request.deviceId);
      const timer = this.#heartbeatTimers.get(request.deviceId);
      if (timer) {
        clearInterval(timer);
        this.#heartbeatTimers.delete(request.deviceId);
      }
    }

    return body;
  }

  dispose(): number {
    const count = this.#heartbeatTimers.size;
    for (const timer of this.#heartbeatTimers.values()) {
      clearInterval(timer);
    }
    this.#heartbeatTimers.clear();
    return count;
  }

  getLeaseId(deviceId: string): string | undefined {
    return this.#leases.get(deviceId);
  }

  async #fetch(url: string, init?: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch {
      throw new Error("Server unavailable");
    }

    if (!res.ok) {
      throw new Error(`Server returned ${res.status}`);
    }

    return res;
  }

  #allocationServerUnavailable(
    request: AllocationRequest,
    message: string,
  ): AllocationFailure {
    return {
      ok: false,
      reason: "server-unavailable",
      deviceId: request.deviceId,
      ownerSkillId: request.ownerSkillId,
      message,
      device: null,
    };
  }

  #releaseServerUnavailable(
    request: ReleaseRequest,
    message: string,
  ): ReleaseFailure {
    return {
      ok: false,
      reason: "server-unavailable",
      deviceId: request.deviceId,
      ownerSkillId: request.ownerSkillId,
      message,
      device: null,
    };
  }
}
