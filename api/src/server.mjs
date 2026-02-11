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

const INSTANCE_ACTIONS = {
  start: "poweron",
  stop: "poweroff",
  restart: "reboot",
};

const PLAN_TEMPLATES = [
  {
    id: "starter",
    profile: "personal",
    serverType: "cpx11",
    title: "Starter",
    description: "Small single-assistant deployment for low traffic.",
  },
  {
    id: "business",
    profile: "business",
    serverType: "cpx21",
    title: "Business",
    description: "Default LaunchClaw business deployment template.",
  },
  {
    id: "builder",
    profile: "developer",
    serverType: "cpx31",
    title: "Builder",
    description: "Developer-focused template with headroom for automations.",
  },
  {
    id: "agency",
    profile: "agency",
    serverType: "cpx41",
    title: "Agency",
    description: "Multi-client template with higher CPU and memory budget.",
  },
];

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

function normalizeAction(action) {
  return action
    ? {
        id: action.id,
        command: action.command,
        status: action.status,
        started: action.started,
        finished: action.finished,
      }
    : null;
}

function parseMonthlyGross(price) {
  const value = Number.parseFloat(String(price ?? ""));
  return Number.isFinite(value) ? value : null;
}

function pickMonthlyGrossPrice(serverType, locationName) {
  const prices = Array.isArray(serverType?.prices) ? serverType.prices : [];
  if (prices.length === 0) {
    return null;
  }

  const wanted = String(locationName || "").trim().toLowerCase();
  const exact = prices.find((entry) => String(entry.location || "").trim().toLowerCase() === wanted);
  if (exact) {
    return parseMonthlyGross(exact.price_monthly?.gross);
  }

  return parseMonthlyGross(prices[0]?.price_monthly?.gross);
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
    action: normalizeAction(action),
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
    action: normalizeAction(action),
  });
}

async function handleInstanceAction(req, res, id, actionName, url) {
  const mappedAction = INSTANCE_ACTIONS[actionName];
  if (!mappedAction) {
    return json(res, 400, {
      error: "Unsupported action",
      supportedActions: Object.keys(INSTANCE_ACTIONS),
    });
  }

  const waitForAction = parseBoolean(url.searchParams.get("wait"), true);

  let result;
  if (mappedAction === "poweron") {
    result = await getHetznerClient().powerOnServer(id);
  } else if (mappedAction === "poweroff") {
    result = await getHetznerClient().powerOffServer(id);
  } else {
    result = await getHetznerClient().rebootServer(id);
  }

  const actionId = result.action?.id;
  let action = result.action || null;
  if (waitForAction && actionId) {
    action = await getHetznerClient().waitForAction(actionId);
  }

  let instance = null;
  try {
    const latest = await getHetznerClient().getServer(id);
    instance = normalizeServerSummary(latest.server);
  } catch {
    // A follow-up GET can fail during state transitions; action status is still returned.
  }

  return json(res, 200, {
    id: Number.parseInt(String(id), 10),
    requestedAction: actionName,
    providerAction: mappedAction,
    action: normalizeAction(action),
    instance,
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

async function handleCatalogAvailability(req, res, url) {
  const serverTypeFilter = String(url.searchParams.get("serverType") || "").trim().toLowerCase();
  const location = String(url.searchParams.get("location") || "").trim();
  const datacenter = String(url.searchParams.get("datacenter") || "").trim();

  const query = new URLSearchParams();
  if (location) {
    query.set("location", location);
  }
  if (datacenter) {
    query.set("name", datacenter);
  }

  const [serverTypeData, datacenterData] = await Promise.all([
    getHetznerClient().listServerTypes(),
    getHetznerClient().listDatacenters(query.toString()),
  ]);

  const serverTypes = Array.isArray(serverTypeData.server_types) ? serverTypeData.server_types : [];
  const datacenters = Array.isArray(datacenterData.datacenters) ? datacenterData.datacenters : [];
  const serverTypeById = new Map(serverTypes.map((entry) => [entry.id, entry]));

  const availability = [];
  for (const center of datacenters) {
    const supported = new Set(center.server_types?.supported || []);
    const available = new Set(center.server_types?.available || []);
    for (const typeId of supported) {
      const serverType = serverTypeById.get(typeId);
      if (!serverType) {
        continue;
      }
      const typeName = String(serverType.name || "").toLowerCase();
      if (serverTypeFilter && ![typeName, String(serverType.id)].includes(serverTypeFilter)) {
        continue;
      }
      availability.push({
        location: center.location?.name || null,
        datacenter: center.name,
        datacenterDescription: center.description,
        serverTypeId: serverType.id,
        serverType: serverType.name,
        available: available.has(typeId),
        monthlyGross: pickMonthlyGrossPrice(serverType, center.location?.name),
        memoryGb: serverType.memory,
        cores: serverType.cores,
      });
    }
  }

  return json(res, 200, {
    filters: {
      location: location || null,
      datacenter: datacenter || null,
      serverType: serverTypeFilter || null,
    },
    availability,
  });
}

async function handleCatalogPlans(req, res, url) {
  const location = String(url.searchParams.get("location") || config.defaults.location || "").trim();
  const datacenter = String(url.searchParams.get("datacenter") || "").trim();

  const query = new URLSearchParams();
  if (location) {
    query.set("location", location);
  }
  if (datacenter) {
    query.set("name", datacenter);
  }

  const [serverTypeData, datacenterData] = await Promise.all([
    getHetznerClient().listServerTypes(),
    getHetznerClient().listDatacenters(query.toString()),
  ]);

  const serverTypes = Array.isArray(serverTypeData.server_types) ? serverTypeData.server_types : [];
  const datacenters = Array.isArray(datacenterData.datacenters) ? datacenterData.datacenters : [];
  const serverTypeByName = new Map(serverTypes.map((entry) => [String(entry.name || "").toLowerCase(), entry]));

  const datacenterAvailability = new Map();
  for (const center of datacenters) {
    const available = new Set(center.server_types?.available || []);
    datacenterAvailability.set(center.name, available);
  }

  const plans = PLAN_TEMPLATES.map((plan) => {
    const serverType = serverTypeByName.get(plan.serverType.toLowerCase());
    const monthlyGross = pickMonthlyGrossPrice(serverType, location);
    const availability = datacenters.map((center) => {
      const availableSet = datacenterAvailability.get(center.name) || new Set();
      return {
        location: center.location?.name || null,
        datacenter: center.name,
        available: Boolean(serverType && availableSet.has(serverType.id)),
        monthlyGross: pickMonthlyGrossPrice(serverType, center.location?.name),
      };
    });

    return {
      id: plan.id,
      title: plan.title,
      description: plan.description,
      profile: plan.profile,
      serverType: plan.serverType,
      memoryGb: serverType?.memory ?? null,
      cores: serverType?.cores ?? null,
      storageType: serverType?.storage_type ?? null,
      monthlyGross,
      currency: "EUR",
      availability,
    };
  });

  return json(res, 200, {
    filters: {
      location: location || null,
      datacenter: datacenter || null,
    },
    plans,
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

    if (url.pathname === "/v1/catalog/availability" && req.method === "GET") {
      return await handleCatalogAvailability(req, res, url);
    }

    if (url.pathname === "/v1/catalog/plans" && req.method === "GET") {
      return await handleCatalogPlans(req, res, url);
    }

    const actionMatch = url.pathname.match(/^\/v1\/instances\/(\d+)\/actions\/([a-z-]+)$/);
    if (actionMatch) {
      const id = actionMatch[1];
      const action = actionMatch[2];
      if (req.method === "POST") {
        return await handleInstanceAction(req, res, id, action, url);
      }
      return methodNotAllowed(res);
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
