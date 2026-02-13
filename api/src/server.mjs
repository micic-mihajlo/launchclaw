import crypto from "node:crypto";
import http from "node:http";
import { buildChannelConfig, normalizeChannels } from "./lib/channels.mjs";
import { CloudflareClient } from "./lib/cloudflare.mjs";
import { loadConfig } from "./lib/config.mjs";
import { renderCloudInit } from "./lib/cloud-init.mjs";
import { json, methodNotAllowed, notFound, parseBoolean, parseJsonBuffer, readJsonBody, readRawBody } from "./lib/http.mjs";
import { HetznerClient } from "./lib/hetzner.mjs";
import { OrdersStore } from "./lib/orders-db.mjs";

const config = loadConfig();
const cloudflareClient = new CloudflareClient(config.cloudflare);
const ordersStore = new OrdersStore(config.databasePath);
let cachedHetznerClient = null;

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

function getHetznerClient() {
  if (cachedHetznerClient) {
    return cachedHetznerClient;
  }
  cachedHetznerClient = new HetznerClient(config.hetznerApiToken);
  return cachedHetznerClient;
}

function createHttpError(message, statusCode = 400, details = undefined) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (details !== undefined) {
    err.details = details;
  }
  return err;
}

function requireAuth(req) {
  if (!config.launchclawApiToken) {
    return;
  }
  const auth = req.headers.authorization || "";
  const expected = `Bearer ${config.launchclawApiToken}`;
  if (auth !== expected) {
    throw createHttpError("Unauthorized", 401);
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

function validateProvisionInput(input) {
  const source = input && typeof input === "object" ? input : {};

  const name = String(source.name || "").trim();
  if (!name) {
    throw createHttpError("name is required", 400);
  }

  const channels = normalizeChannels(source.channels, config.defaults.channels);
  const channelConfig = buildChannelConfig(channels);

  const profile = String(source.profile || config.defaults.profile).trim();
  const model = String(source.model || config.defaults.model).trim();
  const agentName = String(source.agentName || config.defaults.agentName).trim();
  const domain = String(source.domain || "").trim().toLowerCase();
  const gatewayPort = Number.parseInt(String(source.gatewayPort || config.defaults.gatewayPort), 10);

  if (!Number.isFinite(gatewayPort) || gatewayPort < 1 || gatewayPort > 65535) {
    throw createHttpError("gatewayPort must be between 1 and 65535", 400);
  }

  const labels = source.labels && typeof source.labels === "object" ? source.labels : {};
  const location = String(source.location || config.defaults.location || "").trim();
  const datacenter = String(source.datacenter || "").trim();

  return {
    source,
    name,
    channels,
    channelConfig,
    profile,
    model,
    agentName,
    domain,
    gatewayPort,
    serverType: String(source.serverType || config.defaults.serverType).trim(),
    image: String(source.image || config.defaults.image).trim(),
    location,
    datacenter,
    labels,
    sshKeys: normalizeSshKeys(source.sshKeys, config.defaults.sshKeys),
    anthropicKey: String(source.anthropicKey || "").trim(),
    minimaxKey: String(source.minimaxKey || "").trim(),
    discordToken: String(source.discordToken || "").trim(),
    waitForAction: parseBoolean(source.waitForAction, true),
  };
}

function buildCreateServerPayload(spec, extraLabels = {}) {
  const cloudInit = renderCloudInit({
    profile: spec.profile,
    domain: spec.domain,
    model: spec.model,
    agentName: spec.agentName,
    channelConfig: spec.channelConfig,
    anthropicKey: spec.anthropicKey,
    minimaxKey: spec.minimaxKey,
    discordToken: spec.discordToken,
  })
    .replaceAll("\"port\": 18789", `\"port\": ${spec.gatewayPort}`)
    .replaceAll("127.0.0.1:18789", `127.0.0.1:${spec.gatewayPort}`);

  const payload = {
    name: spec.name,
    server_type: spec.serverType,
    image: spec.image,
    user_data: cloudInit,
    start_after_create: true,
    public_net: {
      enable_ipv4: true,
      enable_ipv6: true,
    },
    labels: {
      "managed-by": "launchclaw-api",
      service: "openclaw",
      profile: spec.profile,
      ...spec.labels,
      ...extraLabels,
    },
  };

  if (spec.location) {
    payload.location = spec.location;
  }

  if (spec.datacenter) {
    payload.datacenter = spec.datacenter;
  }

  if (spec.sshKeys.length > 0) {
    payload.ssh_keys = spec.sshKeys;
  }

  return {
    payload,
    cloudInit,
  };
}

function normalizeDnsResult(base) {
  return {
    requested: base.requested,
    configured: base.configured,
    applied: base.applied,
    domain: base.domain || null,
    aRecordId: base.aRecordId || null,
    aaaaRecordId: base.aaaaRecordId || null,
    operations: base.operations || [],
    reason: base.reason || null,
  };
}

async function maybeApplyDns(domain, instance) {
  const normalizedDomain = String(domain || "").trim().toLowerCase();
  if (!normalizedDomain) {
    return normalizeDnsResult({
      requested: false,
      configured: cloudflareClient.configured,
      applied: false,
      reason: "No domain requested",
    });
  }

  if (!cloudflareClient.configured) {
    return normalizeDnsResult({
      requested: true,
      configured: false,
      applied: false,
      domain: normalizedDomain,
      reason: "Cloudflare not configured",
    });
  }

  if (!instance?.ipv4) {
    return normalizeDnsResult({
      requested: true,
      configured: true,
      applied: false,
      domain: normalizedDomain,
      reason: "Instance has no IPv4 yet",
    });
  }

  try {
    const operations = [];
    const a = await cloudflareClient.upsertDnsRecord({
      type: "A",
      name: normalizedDomain,
      content: instance.ipv4,
    });
    operations.push({ type: "A", operation: a.operation, id: a.record?.id || null });

    let aaaaRecordId = null;
    if (cloudflareClient.createAAAA && instance.ipv6) {
      const aaaa = await cloudflareClient.upsertDnsRecord({
        type: "AAAA",
        name: normalizedDomain,
        content: instance.ipv6,
      });
      aaaaRecordId = aaaa.record?.id || null;
      operations.push({ type: "AAAA", operation: aaaa.operation, id: aaaa.record?.id || null });
    }

    return normalizeDnsResult({
      requested: true,
      configured: true,
      applied: true,
      domain: normalizedDomain,
      aRecordId: a.record?.id || null,
      aaaaRecordId,
      operations,
    });
  } catch (error) {
    return normalizeDnsResult({
      requested: true,
      configured: true,
      applied: false,
      domain: normalizedDomain,
      reason: error?.message || "Cloudflare DNS update failed",
    });
  }
}

async function provisionInstanceFromInput(input, options = {}) {
  const spec = validateProvisionInput(input);
  const { payload, cloudInit } = buildCreateServerPayload(spec, options.extraLabels || {});

  const createResult = await getHetznerClient().createServer(payload);
  const actionId = createResult.action?.id;

  let action = createResult.action || null;
  if (spec.waitForAction && actionId) {
    action = await getHetznerClient().waitForAction(actionId);
  }

  let serverData = createResult.server;
  if (serverData?.id) {
    const latest = await getHetznerClient().getServer(serverData.id);
    serverData = latest.server || serverData;
  }

  const instance = normalizeServerSummary(serverData);
  const dns = await maybeApplyDns(spec.domain, instance);

  return {
    instance,
    action: normalizeAction(action),
    dns,
    metadata: {
      profile: spec.profile,
      model: spec.model,
      agentName: spec.agentName,
      channels: spec.channels,
      gatewayPort: spec.gatewayPort,
      cloudInitSha256: crypto.createHash("sha256").update(cloudInit).digest("hex"),
    },
  };
}

function verifyWebhookSignature(rawBody, providedSignature, secret) {
  if (!secret) {
    return true;
  }

  const raw = String(providedSignature || "").trim();
  if (!raw) {
    return false;
  }

  const normalized = raw.startsWith("sha256=") ? raw.slice(7) : raw;
  if (!/^[a-fA-F0-9]+$/.test(normalized)) {
    return false;
  }

  const expectedHex = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const expected = Buffer.from(expectedHex, "hex");
  const provided = Buffer.from(normalized, "hex");
  if (provided.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, provided);
}

async function provisionOrder(orderId, options = {}) {
  const trigger = options.trigger || "manual";
  const force = Boolean(options.force);

  let order = ordersStore.getOrder(orderId);
  if (!order) {
    throw createHttpError("Order not found", 404);
  }

  if (order.status === "running") {
    return {
      order,
      skipped: true,
      reason: "already_running",
    };
  }

  if (order.status === "canceled") {
    return {
      order,
      skipped: true,
      reason: "canceled",
    };
  }

  if (force && (order.status === "pending" || order.status === "failed")) {
    if (order.status === "pending") {
      order = ordersStore.markOrderPaid(order.id, {
        payment: {
          provider: "manual",
          trigger,
          forced: true,
        },
      });
    }
  }

  if (order.status === "pending") {
    throw createHttpError("Order is pending payment", 409);
  }

  if (order.status === "failed" && !force) {
    throw createHttpError("Order failed previously; retry with force=true", 409);
  }

  if (order.status === "provisioning" && !force) {
    return {
      order,
      skipped: true,
      reason: "already_provisioning",
    };
  }

  if (order.status === "paid" || force) {
    const claimed = ordersStore.claimOrderProvisioning(order.id, { force });
    if (!claimed) {
      return {
        order: ordersStore.getOrder(order.id),
        skipped: true,
        reason: "already_claimed",
      };
    }
  }

  order = ordersStore.getOrder(order.id);

  try {
    const result = await provisionInstanceFromInput(order.request, {
      extraLabels: {
        orderId: order.id,
        ...(order.customer?.id ? { customerId: order.customer.id } : {}),
      },
    });

    const updatedOrder = ordersStore.markOrderRunning(order.id, {
      instance: result.instance,
      providerActionId: result.action?.id || null,
      dns: {
        recordAId: result.dns?.aRecordId || null,
        recordAAAAId: result.dns?.aaaaRecordId || null,
      },
      metadata: {
        provisioning: {
          trigger,
          completedAt: new Date().toISOString(),
          metadata: result.metadata,
          dns: result.dns,
        },
      },
    });

    return {
      order: updatedOrder,
      skipped: false,
      provision: result,
    };
  } catch (error) {
    const failedOrder = ordersStore.markOrderFailed(order.id, error?.message || "Provisioning failed", error?.details);
    const err = createHttpError(error?.message || "Provisioning failed", Number.isFinite(error?.statusCode) ? error.statusCode : 502, error?.details);
    err.order = failedOrder;
    throw err;
  }
}

async function handleCreateInstance(req, res) {
  const body = await readJsonBody(req);
  const result = await provisionInstanceFromInput(body);
  return json(res, 201, result);
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

function extractOrderIdentifiers(body) {
  const source = body && typeof body === "object" ? body : {};
  const data = source.data && typeof source.data === "object" ? source.data : {};
  const metadata = data.metadata && typeof data.metadata === "object" ? data.metadata : {};

  const orderId = String(source.orderId || data.orderId || metadata.orderId || "").trim();
  const externalRef = String(source.externalRef || data.externalRef || metadata.externalRef || "").trim();

  return {
    orderId: orderId || null,
    externalRef: externalRef || null,
  };
}

function resolveOrderByIdentifiers(identifiers) {
  if (identifiers.orderId) {
    const direct = ordersStore.getOrder(identifiers.orderId);
    if (direct) {
      return direct;
    }
  }

  if (identifiers.externalRef) {
    return ordersStore.findOrderByExternalRef(identifiers.externalRef);
  }

  return null;
}

async function handleCreateOrder(req, res) {
  const body = await readJsonBody(req);
  const instanceRequest = body?.instance;

  if (!instanceRequest || typeof instanceRequest !== "object") {
    return json(res, 400, { error: "instance object is required" });
  }

  validateProvisionInput(instanceRequest);

  const customer = body.customer && typeof body.customer === "object" ? body.customer : {};
  let order = ordersStore.createOrder({
    customer: {
      name: String(customer.name || "").trim() || null,
      email: String(customer.email || "").trim() || null,
      id: String(customer.id || "").trim() || null,
    },
    externalRef: String(body.externalRef || "").trim() || null,
    planId: String(body.planId || "").trim() || null,
    notes: String(body.notes || "").trim() || null,
    request: instanceRequest,
    metadata: {
      source: "api",
    },
  });

  const shouldMarkPaid = parseBoolean(body.markPaid, false);
  const shouldProvision = parseBoolean(body.provisionNow, config.autoProvisionPaidOrders);
  let provisioning = null;

  if (shouldMarkPaid) {
    order = ordersStore.markOrderPaid(order.id, {
      externalRef: String(body.externalRef || "").trim() || null,
      payment: {
        provider: String(body.paymentProvider || "manual").trim() || "manual",
        eventType: "manual.mark_paid",
      },
    });

    if (shouldProvision) {
      try {
        provisioning = await provisionOrder(order.id, { trigger: "manual_create", force: false });
        order = provisioning.order;
      } catch (error) {
        provisioning = {
          error: error.message,
          details: error.details || undefined,
          order: error.order || ordersStore.getOrder(order.id),
        };
        order = provisioning.order;
      }
    }
  }

  return json(res, 201, {
    order,
    provisioning,
    next: {
      markPaidEndpoint: `/v1/orders/${order.id}/mark-paid`,
      provisionEndpoint: `/v1/orders/${order.id}/provision`,
    },
  });
}

async function handleListOrders(req, res, url) {
  const status = String(url.searchParams.get("status") || "").trim();
  const limit = Number.parseInt(String(url.searchParams.get("limit") || "50"), 10);
  const orders = ordersStore.listOrders({ status: status || null, limit });
  return json(res, 200, { orders });
}

async function handleGetOrder(req, res, orderId, url) {
  const order = ordersStore.getOrder(orderId);
  if (!order) {
    return json(res, 404, { error: "Order not found" });
  }

  const includeEvents = parseBoolean(url.searchParams.get("events"), true);
  return json(res, 200, {
    order,
    events: includeEvents ? ordersStore.listOrderEvents(orderId, Number.parseInt(String(url.searchParams.get("limit") || "100"), 10)) : undefined,
  });
}

async function handleMarkOrderPaid(req, res, orderId, url) {
  const body = await readJsonBody(req);
  const order = ordersStore.markOrderPaid(orderId, {
    externalRef: String(body.externalRef || "").trim() || null,
    allowFailedTransition: true,
    payment: {
      provider: String(body.provider || "manual").trim() || "manual",
      eventType: String(body.eventType || "manual.mark_paid").trim() || "manual.mark_paid",
      eventId: String(body.eventId || "").trim() || null,
      amount: body.amount ?? null,
      currency: String(body.currency || "").trim() || null,
    },
  });

  if (!order) {
    return json(res, 404, { error: "Order not found" });
  }

  const shouldProvision = parseBoolean(url.searchParams.get("provision"), config.autoProvisionPaidOrders);
  if (!shouldProvision) {
    return json(res, 200, { order, provisioning: null });
  }

  try {
    const provisioning = await provisionOrder(orderId, { trigger: "manual_mark_paid" });
    return json(res, 200, { order: provisioning.order, provisioning });
  } catch (error) {
    return json(res, Number.isFinite(error?.statusCode) ? error.statusCode : 502, {
      error: error.message,
      details: error.details || undefined,
      order: error.order || ordersStore.getOrder(orderId),
    });
  }
}

async function handleProvisionOrder(req, res, orderId, url) {
  const force = parseBoolean(url.searchParams.get("force"), false);
  try {
    const provisioning = await provisionOrder(orderId, { trigger: "manual_provision", force });
    return json(res, 200, {
      order: provisioning.order,
      provisioning,
    });
  } catch (error) {
    return json(res, Number.isFinite(error?.statusCode) ? error.statusCode : 502, {
      error: error.message,
      details: error.details || undefined,
      order: error.order || ordersStore.getOrder(orderId),
    });
  }
}

async function handleCancelOrder(req, res, orderId) {
  const body = await readJsonBody(req);
  const reason = String(body.reason || "").trim();
  const order = ordersStore.markOrderCanceled(orderId, reason);
  if (!order) {
    return json(res, 404, { error: "Order not found" });
  }
  return json(res, 200, { order });
}

async function handleOrdersWebhook(req, res) {
  const rawBody = await readRawBody(req);
  const signature = req.headers["x-launchclaw-signature"] || req.headers["x-webhook-signature"] || "";

  if (config.orderWebhookSecret && !verifyWebhookSignature(rawBody, signature, config.orderWebhookSecret)) {
    return json(res, 401, { error: "Invalid webhook signature" });
  }

  const body = parseJsonBuffer(rawBody);
  const type = String(body.type || body.event || "").trim().toLowerCase();
  if (!type) {
    return json(res, 400, { error: "Webhook type is required" });
  }

  const identifiers = extractOrderIdentifiers(body);
  const order = resolveOrderByIdentifiers(identifiers);

  if (!order) {
    return json(res, 202, {
      accepted: true,
      ignored: true,
      reason: "order_not_found",
      type,
      identifiers,
    });
  }

  if (["order.paid", "payment.succeeded", "subscription.active"].includes(type)) {
    const paidOrder = ordersStore.markOrderPaid(order.id, {
      externalRef: identifiers.externalRef,
      allowFailedTransition: true,
      payment: {
        provider: String(body.provider || body.data?.provider || "webhook").trim() || "webhook",
        eventType: type,
        eventId: String(body.eventId || body.data?.eventId || "").trim() || null,
      },
    });

    const shouldProvision = parseBoolean(body.provision, config.autoProvisionPaidOrders);
    if (!shouldProvision) {
      return json(res, 200, {
        accepted: true,
        type,
        order: paidOrder,
        provisioning: null,
      });
    }

    try {
      const provisioning = await provisionOrder(order.id, { trigger: "webhook" });
      return json(res, 200, {
        accepted: true,
        type,
        order: provisioning.order,
        provisioning,
      });
    } catch (error) {
      return json(res, Number.isFinite(error?.statusCode) ? error.statusCode : 502, {
        accepted: true,
        type,
        error: error.message,
        details: error.details || undefined,
        order: error.order || ordersStore.getOrder(order.id),
      });
    }
  }

  if (["order.canceled", "subscription.canceled"].includes(type)) {
    const canceled = ordersStore.markOrderCanceled(order.id, String(body.reason || body.data?.reason || type));
    return json(res, 200, {
      accepted: true,
      type,
      order: canceled,
    });
  }

  if (type === "payment.failed") {
    const failed = ordersStore.markOrderFailed(
      order.id,
      String(body.reason || body.data?.reason || "Payment failed"),
      body.data || null,
      { eventType: "order.payment.failed" }
    );
    return json(res, 200, {
      accepted: true,
      type,
      order: failed,
    });
  }

  return json(res, 200, {
    accepted: true,
    ignored: true,
    reason: "unhandled_event_type",
    type,
    order,
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    if (req.method === "OPTIONS") {
      return json(res, 204, { ok: true });
    }

    if (url.pathname === "/healthz") {
      return json(res, 200, {
        ok: true,
        service: "launchclaw-api",
        cloudflareConfigured: cloudflareClient.configured,
        autoProvisionPaidOrders: config.autoProvisionPaidOrders,
      });
    }

    if (url.pathname === "/v1/webhooks/orders") {
      if (req.method === "POST") {
        return await handleOrdersWebhook(req, res);
      }
      return methodNotAllowed(res);
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

    if (url.pathname === "/v1/orders") {
      if (req.method === "POST") {
        return await handleCreateOrder(req, res);
      }
      if (req.method === "GET") {
        return await handleListOrders(req, res, url);
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

    const instanceActionMatch = url.pathname.match(/^\/v1\/instances\/(\d+)\/actions\/([a-z-]+)$/);
    if (instanceActionMatch) {
      const id = instanceActionMatch[1];
      const action = instanceActionMatch[2];
      if (req.method === "POST") {
        return await handleInstanceAction(req, res, id, action, url);
      }
      return methodNotAllowed(res);
    }

    const orderMarkPaidMatch = url.pathname.match(/^\/v1\/orders\/([^/]+)\/mark-paid$/);
    if (orderMarkPaidMatch) {
      const orderId = orderMarkPaidMatch[1];
      if (req.method === "POST") {
        return await handleMarkOrderPaid(req, res, orderId, url);
      }
      return methodNotAllowed(res);
    }

    const orderProvisionMatch = url.pathname.match(/^\/v1\/orders\/([^/]+)\/provision$/);
    if (orderProvisionMatch) {
      const orderId = orderProvisionMatch[1];
      if (req.method === "POST") {
        return await handleProvisionOrder(req, res, orderId, url);
      }
      return methodNotAllowed(res);
    }

    const orderCancelMatch = url.pathname.match(/^\/v1\/orders\/([^/]+)\/cancel$/);
    if (orderCancelMatch) {
      const orderId = orderCancelMatch[1];
      if (req.method === "POST") {
        return await handleCancelOrder(req, res, orderId);
      }
      return methodNotAllowed(res);
    }

    const instanceMatch = url.pathname.match(/^\/v1\/instances\/(\d+)$/);
    if (instanceMatch) {
      const id = instanceMatch[1];
      if (req.method === "GET") {
        return await handleGetInstance(req, res, id);
      }
      if (req.method === "DELETE") {
        return await handleDeleteInstance(req, res, id, url);
      }
      return methodNotAllowed(res);
    }

    const orderMatch = url.pathname.match(/^\/v1\/orders\/([^/]+)$/);
    if (orderMatch) {
      const orderId = orderMatch[1];
      if (req.method === "GET") {
        return await handleGetOrder(req, res, orderId, url);
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
