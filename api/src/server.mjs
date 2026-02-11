import crypto from "node:crypto";
import http from "node:http";
import { loadConfig } from "./lib/config.mjs";
import { buildChannelConfig, normalizeChannels } from "./lib/channels.mjs";
import { renderCloudInit } from "./lib/cloud-init.mjs";
import { json, methodNotAllowed, notFound, parseBoolean, readJsonBody } from "./lib/http.mjs";
import { HetznerClient } from "./lib/hetzner.mjs";

const config = loadConfig();
let cachedHetznerClient = null;

function getHetznerClient() {
  if (cachedHetznerClient) {
    return cachedHetznerClient;
  }
  cachedHetznerClient = new HetznerClient(config.hetznerApiToken);
  return cachedHetznerClient;
}

function requireAuth(req) {
  if (!config.launchclawApiToken) {
    return;
  }
  const auth = req.headers.authorization || "";
  const expected = `Bearer ${config.launchclawApiToken}`;
  if (auth !== expected) {
    const err = new Error("Unauthorized");
    err.statusCode = 401;
    throw err;
  }
}

function normalizeServerSummary(server) {
  return {
    id: server.id,
    name: server.name,
    status: server.status,
    created: server.created,
    serverType: server.server_type?.name,
    image: server.image?.name,
    location: server.datacenter?.location?.name || server.datacenter?.name || null,
    ipv4: server.public_net?.ipv4?.ip || null,
    ipv6: server.public_net?.ipv6?.ip || null,
    labels: server.labels || {},
  };
}

function normalizeSshKeys(input, defaults) {
  const source = Array.isArray(input) ? input : defaults;
  return source
    .map((v) => {
      const value = String(v).trim();
      if (!value) {
        return null;
      }
      return /^[0-9]+$/.test(value) ? Number.parseInt(value, 10) : value;
    })
    .filter((v) => v != null);
}

async function handleCreateInstance(req, res) {
  const body = await readJsonBody(req);

  const name = String(body.name || "").trim();
  if (!name) {
    return json(res, 400, { error: "name is required" });
  }

  const channels = normalizeChannels(body.channels, config.defaults.channels);
  const channelConfig = buildChannelConfig(channels);

  const profile = String(body.profile || config.defaults.profile).trim();
  const model = String(body.model || config.defaults.model).trim();
  const agentName = String(body.agentName || config.defaults.agentName).trim();
  const domain = String(body.domain || "").trim();
  const gatewayPort = Number.parseInt(String(body.gatewayPort || config.defaults.gatewayPort), 10);

  if (!Number.isFinite(gatewayPort) || gatewayPort < 1 || gatewayPort > 65535) {
    return json(res, 400, { error: "gatewayPort must be between 1 and 65535" });
  }

  const cloudInit = renderCloudInit({
    profile,
    domain,
    model,
    agentName,
    channelConfig,
    anthropicKey: String(body.anthropicKey || "").trim(),
    discordToken: String(body.discordToken || "").trim(),
  }).replaceAll("\"port\": 18789", `\"port\": ${gatewayPort}`).replaceAll("127.0.0.1:18789", `127.0.0.1:${gatewayPort}`);

  const payload = {
    name,
    server_type: String(body.serverType || config.defaults.serverType).trim(),
    image: String(body.image || config.defaults.image).trim(),
    user_data: cloudInit,
    start_after_create: true,
    public_net: {
      enable_ipv4: true,
      enable_ipv6: true,
    },
    labels: {
      "managed-by": "launchclaw-api",
      service: "openclaw",
      profile,
      ...(body.labels && typeof body.labels === "object" ? body.labels : {}),
    },
  };

  const location = String(body.location || config.defaults.location || "").trim();
  if (location) {
    payload.location = location;
  }

  const datacenter = String(body.datacenter || "").trim();
  if (datacenter) {
    payload.datacenter = datacenter;
  }

  const sshKeys = normalizeSshKeys(body.sshKeys, config.defaults.sshKeys);
  if (sshKeys.length > 0) {
    payload.ssh_keys = sshKeys;
  }

  const createResult = await getHetznerClient().createServer(payload);
  const actionId = createResult.action?.id;
  const waitForAction = parseBoolean(body.waitForAction, true);

  let action = createResult.action || null;
  if (waitForAction && actionId) {
    action = await getHetznerClient().waitForAction(actionId);
  }

  let serverData = createResult.server;
  if (serverData?.id) {
    const latest = await getHetznerClient().getServer(serverData.id);
    serverData = latest.server || serverData;
  }

  return json(res, 201, {
    instance: normalizeServerSummary(serverData),
    action: action
      ? {
          id: action.id,
          command: action.command,
          status: action.status,
          started: action.started,
          finished: action.finished,
        }
      : null,
    metadata: {
      profile,
      model,
      agentName,
      channels,
      gatewayPort,
      cloudInitSha256: crypto.createHash("sha256").update(cloudInit).digest("hex"),
    },
  });
}

async function handleListInstances(req, res, url) {
  const managedOnly = parseBoolean(url.searchParams.get("managedOnly"), true);
  const searchParams = new URLSearchParams();
  if (managedOnly) {
    searchParams.set("label_selector", "managed-by=launchclaw-api");
  }

  const data = await getHetznerClient().listServers(searchParams.toString());
  const servers = Array.isArray(data.servers) ? data.servers : [];
  return json(res, 200, { instances: servers.map(normalizeServerSummary) });
}

async function handleGetInstance(req, res, id) {
  const data = await getHetznerClient().getServer(id);
  return json(res, 200, { instance: normalizeServerSummary(data.server) });
}

async function handleDeleteInstance(req, res, id, url) {
  const waitForAction = parseBoolean(url.searchParams.get("wait"), true);
  const result = await getHetznerClient().deleteServer(id);
  const actionId = result.action?.id;
  let action = result.action || null;

  if (waitForAction && actionId) {
    action = await getHetznerClient().waitForAction(actionId);
  }

  return json(res, 200, {
    deleted: true,
    id: Number.parseInt(String(id), 10),
    action: action
      ? {
          id: action.id,
          command: action.command,
          status: action.status,
          started: action.started,
          finished: action.finished,
        }
      : null,
  });
}

async function handleCatalogLocations(req, res) {
  const data = await getHetznerClient().listLocations();
  return json(res, 200, {
    locations: (data.locations || []).map((x) => ({
      id: x.id,
      name: x.name,
      description: x.description,
      city: x.city,
      country: x.country,
      latitude: x.latitude,
      longitude: x.longitude,
      networkZone: x.network_zone,
    })),
  });
}

async function handleCatalogServerTypes(req, res) {
  const data = await getHetznerClient().listServerTypes();
  return json(res, 200, {
    serverTypes: (data.server_types || []).map((x) => ({
      id: x.id,
      name: x.name,
      description: x.description,
      cores: x.cores,
      memoryGb: x.memory,
      diskGb: x.disk,
      architecture: x.architecture,
      storageType: x.storage_type,
      cpuType: x.cpu_type,
      prices: x.prices,
    })),
  });
}

async function handleCatalogImages(req, res, url) {
  const type = String(url.searchParams.get("type") || "system").trim();
  const query = new URLSearchParams();
  if (type) {
    query.set("type", type);
  }

  const data = await getHetznerClient().listImages(query.toString());
  return json(res, 200, {
    images: (data.images || []).map((x) => ({
      id: x.id,
      name: x.name,
      description: x.description,
      type: x.type,
      osFlavor: x.os_flavor,
      osVersion: x.os_version,
      architecture: x.architecture,
      status: x.status,
      deprecated: x.deprecated,
    })),
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "OPTIONS") {
      return json(res, 204, { ok: true });
    }

    if (url.pathname === "/healthz") {
      return json(res, 200, { ok: true, service: "launchclaw-api" });
    }

    requireAuth(req);

    if (url.pathname === "/v1/instances") {
      if (req.method === "POST") {
        return await handleCreateInstance(req, res);
      }
      if (req.method === "GET") {
        return await handleListInstances(req, res, url);
      }
      return methodNotAllowed(res);
    }

    if (url.pathname === "/v1/catalog/locations" && req.method === "GET") {
      return await handleCatalogLocations(req, res);
    }

    if (url.pathname === "/v1/catalog/server-types" && req.method === "GET") {
      return await handleCatalogServerTypes(req, res);
    }

    if (url.pathname === "/v1/catalog/images" && req.method === "GET") {
      return await handleCatalogImages(req, res, url);
    }

    const match = url.pathname.match(/^\/v1\/instances\/(\d+)$/);
    if (match) {
      const id = match[1];
      if (req.method === "GET") {
        return await handleGetInstance(req, res, id);
      }
      if (req.method === "DELETE") {
        return await handleDeleteInstance(req, res, id, url);
      }
      return methodNotAllowed(res);
    }

    return notFound(res);
  } catch (error) {
    const statusCode = Number.isFinite(error?.statusCode) ? error.statusCode : 500;
    return json(res, statusCode, {
      error: error?.message || "Internal server error",
      details: error?.details || undefined,
    });
  }
});

server.listen(config.port, () => {
  console.log(`launchclaw-api listening on http://localhost:${config.port}`);
});
