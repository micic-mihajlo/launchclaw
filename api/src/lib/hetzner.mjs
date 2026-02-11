const BASE_URL = "https://api.hetzner.cloud/v1";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HetznerClient {
  constructor(apiToken) {
    if (!apiToken) {
      throw new Error("Missing HETZNER_API_TOKEN");
    }
    this.apiToken = apiToken;
  }

  async request(method, resourcePath, body) {
    const res = await fetch(`${BASE_URL}${resourcePath}`, {
      method,
      headers: {
        authorization: `Bearer ${this.apiToken}`,
        "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    const data = text ? JSON.parse(text) : {};

    if (!res.ok) {
      const err = new Error(data?.error?.message || `Hetzner API error (${res.status})`);
      err.statusCode = res.status;
      err.details = data;
      throw err;
    }

    return data;
  }

  async createServer(payload) {
    return this.request("POST", "/servers", payload);
  }

  async getServer(serverId) {
    return this.request("GET", `/servers/${serverId}`);
  }

  async listServers(query = "") {
    const suffix = query ? `?${query}` : "";
    return this.request("GET", `/servers${suffix}`);
  }

  async deleteServer(serverId) {
    return this.request("DELETE", `/servers/${serverId}`);
  }

  async getAction(actionId) {
    return this.request("GET", `/actions/${actionId}`);
  }

  async listLocations() {
    return this.request("GET", "/locations");
  }

  async listServerTypes() {
    return this.request("GET", "/server_types");
  }

  async listImages(query = "") {
    const suffix = query ? `?${query}` : "";
    return this.request("GET", `/images${suffix}`);
  }

  async waitForAction(actionId, options = {}) {
    const intervalMs = options.intervalMs ?? 2500;
    const timeoutMs = options.timeoutMs ?? 180000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const data = await this.getAction(actionId);
      const action = data.action;
      if (!action) {
        break;
      }

      if (action.status === "success") {
        return action;
      }

      if (action.status === "error") {
        const err = new Error(action?.error?.message || "Hetzner action failed");
        err.statusCode = 502;
        err.details = action;
        throw err;
      }

      await sleep(intervalMs);
    }

    const err = new Error(`Timeout waiting for Hetzner action ${actionId}`);
    err.statusCode = 504;
    throw err;
  }
}
