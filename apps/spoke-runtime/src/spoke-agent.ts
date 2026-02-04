import type { HubClient } from './hub-client.js';
import type { HeartbeatRequest } from '@eurocomply/types';

export interface SpokeAgentConfig {
  spokeId: string;
  osVersion: string;
  intervalMs?: number;
}

export class SpokeAgent {
  private timer: ReturnType<typeof setInterval> | null = null;
  private startTime = Date.now();

  constructor(
    private client: HubClient,
    private config: SpokeAgentConfig,
  ) {}

  start(): void {
    const interval = this.config.intervalMs ?? 60_000;
    this.sendHeartbeat();
    this.timer = setInterval(() => this.sendHeartbeat(), interval);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async sendHeartbeat(): Promise<void> {
    const hb: HeartbeatRequest = {
      spoke_id: this.config.spokeId,
      os_version: this.config.osVersion,
      status: 'healthy',
      uptime_seconds: Math.floor((Date.now() - this.startTime) / 1000),
      usage: {
        product_count: 0,
        user_count: 0,
        evaluation_count_24h: 0,
      },
    };

    try {
      const response = await this.client.sendHeartbeat(hb);
      if (!response.license_valid) {
        console.warn(`[SpokeAgent] License invalid for ${this.config.spokeId}`);
      }
      if (response.signals.message) {
        console.info(`[SpokeAgent] Hub message: ${response.signals.message}`);
      }
    } catch (err) {
      console.error(`[SpokeAgent] Heartbeat failed:`, err);
    }
  }
}
