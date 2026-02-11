const BASE_URL = "https://api.cloudflare.com/client/v4";

export class CloudflareClient {
  constructor(options) {
    this.apiToken = options?.apiToken || "";
    this.zoneId = options?.zoneId || "";
    this.defaultProxied = Boolean(options?.proxied);
    this.defaultTtl = Number.isFinite(options?.ttl) ? options.ttl : 120;
    this.createAAAA = Boolean(options?.createAAAA);
  }

  get configured() {
    return Boolean(this.apiToken && this.zoneId);
  }

  async request(method, resourcePath, body) {
    if (!this.configured) {
      throw new Error("Cloudflare is not configured");
    }

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
    if (!res.ok || data?.success === false) {
      const errorMessage =
        data?.errors?.[0]?.message || data?.result?.errors?.[0]?.message || `Cloudflare API error (${res.status})`;
      const err = new Error(errorMessage);
      err.statusCode = res.status;
      err.details = data;
      throw err;
    }
    return data;
  }

  async listDnsRecords(query = {}) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      const normalized = String(value || "").trim();
      if (normalized) {
        params.set(key, normalized);
      }
    }
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    return this.request("GET", `/zones/${this.zoneId}/dns_records${suffix}`);
  }

  async createDnsRecord(payload) {
    return this.request("POST", `/zones/${this.zoneId}/dns_records`, payload);
  }

  async updateDnsRecord(recordId, payload) {
    return this.request("PATCH", `/zones/${this.zoneId}/dns_records/${recordId}`, payload);
  }

  async upsertDnsRecord({ type, name, content, proxied = this.defaultProxied, ttl = this.defaultTtl }) {
    const existing = await this.listDnsRecords({ type, name, per_page: "100" });
    const records = Array.isArray(existing.result) ? existing.result : [];
    const first = records[0];

    if (first) {
      const updated = await this.updateDnsRecord(first.id, { type, name, content, proxied, ttl });
      return {
        operation: "updated",
        record: updated.result,
      };
    }

    const created = await this.createDnsRecord({ type, name, content, proxied, ttl });
    return {
      operation: "created",
      record: created.result,
    };
  }
}
