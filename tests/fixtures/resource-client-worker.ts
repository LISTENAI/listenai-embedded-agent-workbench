import { HttpResourceManager } from "@listenai/resource-client";

interface WorkerResult {
  ok: boolean;
  ownerSkillId: string;
  deviceId: string;
  leaseId?: string;
  reason?: string;
  message?: string;
}

async function main(): Promise<void> {
  const baseUrl = process.env.BASE_URL;
  const deviceId = process.env.DEVICE_ID;
  const ownerSkillId = process.env.OWNER_SKILL_ID;

  if (!baseUrl || !deviceId || !ownerSkillId) {
    throw new Error("BASE_URL, DEVICE_ID, and OWNER_SKILL_ID are required");
  }

  const manager = new HttpResourceManager(baseUrl);

  try {
    const result = await manager.allocateDevice({
      deviceId,
      ownerSkillId,
      requestedAt: new Date().toISOString(),
    });

    const payload: WorkerResult = result.ok
      ? {
          ok: true,
          ownerSkillId,
          deviceId,
          leaseId: manager.getLeaseId(deviceId),
        }
      : {
          ok: false,
          ownerSkillId,
          deviceId,
          reason: result.reason,
          message: result.message,
        };

    process.stdout.write(`${JSON.stringify(payload)}\n`);
  } finally {
    manager.dispose();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
