const SUPPORTED = new Set(["discord", "telegram", "whatsapp", "slack", "signal"]);

function channelEntry(name) {
  switch (name) {
    case "discord":
      // Default OpenClaw behavior is typically "allowlist" for guilds; if we
      // don't specify this, a newly provisioned bot often appears "silent" in
      // servers until explicitly allowlisted. "open" makes first-run testing
      // and onboarding work out of the box.
      return { enabled: true, groupPolicy: "open", dm: { enabled: true, policy: "pairing" } };
    case "telegram":
      return { enabled: true, dmPolicy: "pairing" };
    case "whatsapp":
      return { enabled: true, dmPolicy: "pairing" };
    case "slack":
      return { enabled: true, dm: { enabled: true, policy: "pairing" } };
    case "signal":
      return { enabled: true, dmPolicy: "pairing" };
    default:
      return null;
  }
}

export function normalizeChannels(input, fallback = ["discord"]) {
  const raw = Array.isArray(input) ? input : fallback;
  const out = [];
  const seen = new Set();

  for (const value of raw) {
    const ch = String(value || "").trim().toLowerCase();
    if (!ch || seen.has(ch) || !SUPPORTED.has(ch)) {
      continue;
    }
    seen.add(ch);
    out.push(ch);
  }

  return out.length > 0 ? out : ["discord"];
}

export function buildChannelConfig(channels) {
  const cfg = {};
  for (const channel of channels) {
    const entry = channelEntry(channel);
    if (entry) {
      cfg[channel] = entry;
    }
  }
  return cfg;
}
