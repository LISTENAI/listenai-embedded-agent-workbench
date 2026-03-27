import { serve } from "@hono/node-server";
import type { ResourceManager } from "@listenai/contracts";
import type { AddressInfo } from "node:net";
import type { LeaseManager } from "./lease-manager.js";
import { createApp } from "./app.js";

export interface ServerOptions {
  port: number;
  host: string;
  manager: ResourceManager;
  leaseManager: LeaseManager;
  scanIntervalMs?: number;
}

export interface ServerStartInfo {
  host: string;
  port: number;
  url: string;
}

function toStartInfo(server: { address(): string | AddressInfo | null }, fallbackHost: string): ServerStartInfo {
  const address = server.address();
  if (address && typeof address !== "string") {
    const host = address.address && address.address !== "::" ? address.address : fallbackHost;
    return {
      host,
      port: address.port,
      url: `http://${host}:${address.port}`
    };
  }

  return {
    host: fallbackHost,
    port: 0,
    url: `http://${fallbackHost}:0`
  };
}

export function createServer(options: ServerOptions) {
  const app = createApp(options.manager, options.leaseManager);
  const scanIntervalMs = options.scanIntervalMs ?? 10000;

  let server: ReturnType<typeof serve> | null = null;
  let scanInterval: ReturnType<typeof setInterval> | null = null;

  return {
    async start(): Promise<ServerStartInfo> {
      if (!server) {
        server = serve({
          fetch: app.fetch,
          port: options.port,
          hostname: options.host
        });
      }

      const startInfo = await new Promise<ServerStartInfo>((resolve, reject) => {
        const activeServer = server;
        if (!activeServer) {
          reject(new Error("Server failed to initialize"));
          return;
        }

        const onError = (error: Error) => {
          activeServer.off("listening", onListening);
          reject(error);
        };
        const onListening = () => {
          activeServer.off("error", onError);
          resolve(toStartInfo(activeServer, options.host));
        };

        if (activeServer.listening) {
          resolve(toStartInfo(activeServer, options.host));
          return;
        }

        activeServer.once("error", onError);
        activeServer.once("listening", onListening);
      });

      if (!scanInterval) {
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
        }, scanIntervalMs);
      }

      console.log(`Server listening on ${startInfo.url}`);
      return startInfo;
    },
    stop() {
      if (scanInterval) {
        clearInterval(scanInterval);
        scanInterval = null;
      }
      if (server) {
        server.close();
        server = null;
      }
      console.log("Server stopped");
    }
  };
}
