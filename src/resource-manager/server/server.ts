import { serve } from "@hono/node-server";
import type { ResourceManager } from "../resource-manager.js";
import type { LeaseManager } from "./lease-manager.js";
import { createApp } from "./app.js";

export interface ServerOptions {
  port: number;
  host: string;
  manager: ResourceManager;
  leaseManager: LeaseManager;
}

export function createServer(options: ServerOptions) {
  const app = createApp(options.manager, options.leaseManager);
  const server = serve({
    fetch: app.fetch,
    port: options.port,
    hostname: options.host,
  });

  let scanInterval: NodeJS.Timeout | null = null;

  return {
    start() {
      console.log(`Server listening on http://${options.host}:${options.port}`);
      
      // Start lease expiry scan every 10 seconds
      scanInterval = setInterval(() => {
        const expiredCount = options.leaseManager.scanExpired(async (lease) => {
          console.log(`Lease expired for device ${lease.deviceId}`);
          await options.manager.releaseDevice({
            deviceId: lease.deviceId,
            ownerSkillId: lease.ownerSkillId,
            releasedAt: new Date().toISOString()
          });
        });
        if (expiredCount > 0) {
          console.log(`Released ${expiredCount} expired lease(s)`);
        }
      }, 10000);
    },
    stop() {
      if (scanInterval) {
        clearInterval(scanInterval);
        scanInterval = null;
      }
      server.close();
      console.log("Server stopped");
    },
  };
}
