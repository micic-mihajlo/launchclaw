import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_DB_PATH = path.resolve(__dirname, "../../data/launchclaw.db");

function parseDotEnv(content) {
  const env = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const idx = line.indexOf("=");
    if (idx === -1) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function loadDotEnvIfPresent() {
  const envPath = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }
  const parsed = parseDotEnv(fs.readFileSync(envPath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function parseIntWithDefault(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseBoolWithDefault(value, fallback) {
  if (value == null || value === "") {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "y";
}

function parseCsv(value) {
  if (!value) {
    return [];
  }
  return String(value)
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export function loadConfig() {
  loadDotEnvIfPresent();

  return {
    port: parseIntWithDefault(process.env.PORT, 8787),
    launchclawApiToken: process.env.LAUNCHCLAW_API_TOKEN?.trim() || "",
    hetznerApiToken: process.env.HETZNER_API_TOKEN?.trim() || "",
    orderWebhookSecret: process.env.ORDER_WEBHOOK_SECRET?.trim() || "",
    autoProvisionPaidOrders: parseBoolWithDefault(process.env.AUTO_PROVISION_PAID_ORDERS, true),
    databasePath: process.env.LAUNCHCLAW_DB_PATH?.trim() || DEFAULT_DB_PATH,
    cloudflare: {
      apiToken: process.env.CLOUDFLARE_API_TOKEN?.trim() || "",
      zoneId: process.env.CLOUDFLARE_ZONE_ID?.trim() || "",
      proxied: parseBoolWithDefault(process.env.CLOUDFLARE_PROXIED, false),
      ttl: parseIntWithDefault(process.env.CLOUDFLARE_TTL, 120),
      createAAAA: parseBoolWithDefault(process.env.CLOUDFLARE_CREATE_AAAA, false),
    },
    defaults: {
      image: process.env.HETZNER_DEFAULT_IMAGE?.trim() || "ubuntu-24.04",
      serverType: process.env.HETZNER_DEFAULT_SERVER_TYPE?.trim() || "cpx21",
      location: process.env.HETZNER_DEFAULT_LOCATION?.trim() || "",
      sshKeys: parseCsv(process.env.HETZNER_DEFAULT_SSH_KEYS),
      profile: process.env.DEFAULT_PROFILE?.trim() || "business",
      model: process.env.DEFAULT_MODEL?.trim() || "anthropic/claude-sonnet-4-5",
      agentName: process.env.DEFAULT_AGENT_NAME?.trim() || "Assistant",
      channels: parseCsv(process.env.DEFAULT_CHANNELS || "discord"),
      gatewayPort: parseIntWithDefault(process.env.DEFAULT_GATEWAY_PORT, 18789),
    },
  };
}
