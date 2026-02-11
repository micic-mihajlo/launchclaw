const MAX_BODY_BYTES = 1024 * 1024;

export async function readRawBody(req, maxBytes = MAX_BODY_BYTES) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const err = new Error("Payload too large");
      err.statusCode = 413;
      throw err;
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

export function parseJsonBuffer(rawBuffer) {
  const raw = rawBuffer.toString("utf8").trim();
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    const err = new Error("Invalid JSON body");
    err.statusCode = 400;
    throw err;
  }
}

export async function readJsonBody(req) {
  const raw = await readRawBody(req);
  return parseJsonBuffer(raw);
}

export function json(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type,authorization");
  res.end(body);
}

export function notFound(res) {
  return json(res, 404, { error: "Not found" });
}

export function methodNotAllowed(res) {
  return json(res, 405, { error: "Method not allowed" });
}

export function parseBoolean(value, fallback = false) {
  if (value == null) {
    return fallback;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "y";
}
