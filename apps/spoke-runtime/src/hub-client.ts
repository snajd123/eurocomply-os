import type { HeartbeatRequest, HeartbeatResponse } from '@eurocomply/types';

export class HubClient {
  constructor(
    private hubUrl: string,
    private apiKey: string,
  ) {}

  async sendHeartbeat(hb: HeartbeatRequest): Promise<HeartbeatResponse> {
    const response = await fetch(`${this.hubUrl}/hub/api/v1/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(hb),
    });
    if (!response.ok) {
      throw new Error(`Heartbeat failed: ${response.status}`);
    }
    return response.json() as Promise<HeartbeatResponse>;
  }

  async registerDirectory(entry: {
    did: string;
    spoke_id: string;
    endpoint: string;
    capabilities: string[];
  }): Promise<void> {
    const response = await fetch(`${this.hubUrl}/hub/api/v1/directory`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(entry),
    });
    if (!response.ok) {
      throw new Error(`Directory registration failed: ${response.status}`);
    }
  }
}
