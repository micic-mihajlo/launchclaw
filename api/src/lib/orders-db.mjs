import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const TERMINAL_STATUSES = new Set(["running", "failed", "canceled"]);

function nowIso() {
  return new Date().toISOString();
}

function parseJsonOrNull(value) {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export class OrdersStore {
  constructor(databasePath) {
    if (!databasePath) {
      throw new Error("Missing database path");
    }
    const parent = path.dirname(databasePath);
    fs.mkdirSync(parent, { recursive: true });
    this.db = new DatabaseSync(databasePath);
    this.#init();
  }

  #init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        customer_name TEXT,
        customer_email TEXT,
        customer_id TEXT,
        external_ref TEXT,
        plan_id TEXT,
        notes TEXT,
        request_json TEXT NOT NULL,
        metadata_json TEXT,
        instance_id INTEGER,
        instance_name TEXT,
        instance_ipv4 TEXT,
        instance_ipv6 TEXT,
        provider_action_id INTEGER,
        dns_record_a_id TEXT,
        dns_record_aaaa_id TEXT,
        error_message TEXT,
        paid_at TEXT,
        canceled_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
      CREATE INDEX IF NOT EXISTS idx_orders_external_ref ON orders(external_ref);

      CREATE TABLE IF NOT EXISTS order_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        payload_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_order_events_order_id ON order_events(order_id);
      CREATE INDEX IF NOT EXISTS idx_order_events_created_at ON order_events(created_at);
    `);
  }

  #normalizeOrderRow(row) {
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      customer: {
        name: row.customer_name || null,
        email: row.customer_email || null,
        id: row.customer_id || null,
      },
      externalRef: row.external_ref || null,
      planId: row.plan_id || null,
      notes: row.notes || null,
      request: parseJsonOrNull(row.request_json),
      metadata: parseJsonOrNull(row.metadata_json),
      paidAt: row.paid_at || null,
      canceledAt: row.canceled_at || null,
      instance: row.instance_id
        ? {
            id: row.instance_id,
            name: row.instance_name || null,
            ipv4: row.instance_ipv4 || null,
            ipv6: row.instance_ipv6 || null,
          }
        : null,
      providerActionId: row.provider_action_id || null,
      dns: {
        recordAId: row.dns_record_a_id || null,
        recordAAAAId: row.dns_record_aaaa_id || null,
      },
      errorMessage: row.error_message || null,
    };
  }

  #appendEvent(orderId, eventType, payload) {
    const statement = this.db.prepare(`
      INSERT INTO order_events(order_id, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?)
    `);
    statement.run(orderId, eventType, payload ? JSON.stringify(payload) : null, nowIso());
  }

  createOrder(input) {
    const id = input?.id ? String(input.id).trim() : crypto.randomUUID();
    const createdAt = nowIso();
    const row = {
      id,
      status: "pending",
      created_at: createdAt,
      updated_at: createdAt,
      customer_name: input?.customer?.name || null,
      customer_email: input?.customer?.email || null,
      customer_id: input?.customer?.id || null,
      external_ref: input?.externalRef || null,
      plan_id: input?.planId || null,
      notes: input?.notes || null,
      request_json: JSON.stringify(input?.request || {}),
      metadata_json: input?.metadata ? JSON.stringify(input.metadata) : null,
      instance_id: null,
      instance_name: null,
      instance_ipv4: null,
      instance_ipv6: null,
      provider_action_id: null,
      dns_record_a_id: null,
      dns_record_aaaa_id: null,
      error_message: null,
      paid_at: null,
      canceled_at: null,
    };

    const statement = this.db.prepare(`
      INSERT INTO orders(
        id, status, created_at, updated_at, customer_name, customer_email, customer_id, external_ref, plan_id, notes,
        request_json, metadata_json, instance_id, instance_name, instance_ipv4, instance_ipv6, provider_action_id,
        dns_record_a_id, dns_record_aaaa_id, error_message, paid_at, canceled_at
      )
      VALUES (
        $id, $status, $created_at, $updated_at, $customer_name, $customer_email, $customer_id, $external_ref, $plan_id, $notes,
        $request_json, $metadata_json, $instance_id, $instance_name, $instance_ipv4, $instance_ipv6, $provider_action_id,
        $dns_record_a_id, $dns_record_aaaa_id, $error_message, $paid_at, $canceled_at
      )
    `);

    statement.run(row);
    this.#appendEvent(id, "order.created", {
      customer: input?.customer || null,
      externalRef: input?.externalRef || null,
      planId: input?.planId || null,
    });
    return this.getOrder(id);
  }

  getOrder(orderId) {
    const statement = this.db.prepare(`SELECT * FROM orders WHERE id = ?`);
    const row = statement.get(orderId);
    return this.#normalizeOrderRow(row);
  }

  findOrderByExternalRef(externalRef) {
    const normalized = String(externalRef || "").trim();
    if (!normalized) {
      return null;
    }
    const statement = this.db.prepare(`SELECT * FROM orders WHERE external_ref = ? ORDER BY created_at DESC LIMIT 1`);
    const row = statement.get(normalized);
    return this.#normalizeOrderRow(row);
  }

  listOrders(options = {}) {
    const limit = Math.min(Math.max(Number.parseInt(String(options.limit ?? "50"), 10) || 50, 1), 200);
    const status = String(options.status || "").trim();

    if (status) {
      const statement = this.db.prepare(`
        SELECT * FROM orders
        WHERE status = ?
        ORDER BY created_at DESC
        LIMIT ?
      `);
      const rows = statement.all(status, limit);
      return rows.map((row) => this.#normalizeOrderRow(row));
    }

    const statement = this.db.prepare(`
      SELECT * FROM orders
      ORDER BY created_at DESC
      LIMIT ?
    `);
    const rows = statement.all(limit);
    return rows.map((row) => this.#normalizeOrderRow(row));
  }

  listOrderEvents(orderId, limit = 100) {
    const normalizedLimit = Math.min(Math.max(Number.parseInt(String(limit), 10) || 100, 1), 500);
    const statement = this.db.prepare(`
      SELECT id, order_id, event_type, payload_json, created_at
      FROM order_events
      WHERE order_id = ?
      ORDER BY id DESC
      LIMIT ?
    `);
    const rows = statement.all(orderId, normalizedLimit);
    return rows.map((row) => ({
      id: row.id,
      orderId: row.order_id,
      type: row.event_type,
      payload: parseJsonOrNull(row.payload_json),
      createdAt: row.created_at,
    }));
  }

  markOrderPaid(orderId, options = {}) {
    const existing = this.getOrder(orderId);
    if (!existing) {
      return null;
    }
    if (existing.status === "canceled") {
      return existing;
    }
    const allowFailedTransition = Boolean(options.allowFailedTransition);
    const allowedStatuses = allowFailedTransition ? new Set(["pending", "paid", "failed"]) : new Set(["pending", "paid"]);
    if (!allowedStatuses.has(existing.status)) {
      return existing;
    }

    const paidAt = existing.paidAt || nowIso();
    const updatedAt = nowIso();
    const mergedMetadata = {
      ...(existing.metadata || {}),
      payment: {
        ...(existing.metadata?.payment || {}),
        ...(options.payment || {}),
      },
    };

    const statement = this.db.prepare(`
      UPDATE orders
      SET
        status = CASE
          WHEN status = 'pending' THEN 'paid'
          WHEN status = 'failed' AND ? = 1 THEN 'paid'
          ELSE status
        END,
        updated_at = ?,
        paid_at = COALESCE(paid_at, ?),
        external_ref = COALESCE(external_ref, ?),
        metadata_json = ?,
        error_message = CASE WHEN status = 'failed' THEN NULL ELSE error_message END
      WHERE id = ? AND status IN (${allowFailedTransition ? "'pending','paid','failed'" : "'pending','paid'"})
    `);
    const result = statement.run(
      allowFailedTransition ? 1 : 0,
      updatedAt,
      paidAt,
      options.externalRef || null,
      JSON.stringify(mergedMetadata),
      orderId
    );

    const updated = this.getOrder(orderId);
    if (result.changes > 0 && existing.status !== "paid" && updated?.status === "paid") {
      this.#appendEvent(orderId, "order.paid", {
        externalRef: options.externalRef || null,
        payment: options.payment || null,
      });
    }
    return updated;
  }

  claimOrderProvisioning(orderId, options = {}) {
    const force = Boolean(options.force);
    const statement = force
      ? this.db.prepare(`
          UPDATE orders
          SET status = 'provisioning', updated_at = ?, error_message = NULL
          WHERE id = ? AND status IN ('pending', 'paid', 'failed', 'provisioning')
        `)
      : this.db.prepare(`
          UPDATE orders
          SET status = 'provisioning', updated_at = ?
          WHERE id = ? AND status = 'paid'
        `);

    const result = statement.run(nowIso(), orderId);
    const claimed = result.changes > 0;
    if (claimed) {
      this.#appendEvent(orderId, "order.provisioning.started", {
        force,
      });
    }
    return claimed;
  }

  markOrderRunning(orderId, payload = {}) {
    const existing = this.getOrder(orderId);
    if (!existing) {
      return null;
    }
    if (existing.status === "canceled") {
      return existing;
    }

    const statement = this.db.prepare(`
      UPDATE orders
      SET
        status = 'running',
        updated_at = ?,
        instance_id = ?,
        instance_name = ?,
        instance_ipv4 = ?,
        instance_ipv6 = ?,
        provider_action_id = ?,
        dns_record_a_id = ?,
        dns_record_aaaa_id = ?,
        metadata_json = ?,
        error_message = NULL
      WHERE id = ? AND status = 'provisioning'
    `);

    const instance = payload.instance || {};
    const dns = payload.dns || {};
    const metadata = payload.metadata
      ? {
          ...(existing.metadata || {}),
          ...payload.metadata,
        }
      : existing.metadata;

    const result = statement.run(
      nowIso(),
      instance.id || null,
      instance.name || null,
      instance.ipv4 || null,
      instance.ipv6 || null,
      payload.providerActionId || null,
      dns.recordAId || null,
      dns.recordAAAAId || null,
      metadata ? JSON.stringify(metadata) : null,
      orderId
    );
    if (result.changes === 0) {
      return this.getOrder(orderId);
    }

    this.#appendEvent(orderId, "order.provisioning.succeeded", {
      instanceId: instance.id || null,
      instanceName: instance.name || null,
      dns,
    });
    return this.getOrder(orderId);
  }

  markOrderFailed(orderId, error, details = null, options = {}) {
    const existing = this.getOrder(orderId);
    if (!existing) {
      return null;
    }
    if (TERMINAL_STATUSES.has(existing.status) && existing.status !== "failed") {
      return existing;
    }
    const message = String(error || "Provisioning failed").slice(0, 8000);
    const statement = this.db.prepare(`
      UPDATE orders
      SET status = 'failed', updated_at = ?, error_message = ?
      WHERE id = ? AND status NOT IN ('running', 'canceled')
    `);
    const result = statement.run(nowIso(), message, orderId);
    if (result.changes === 0) {
      return this.getOrder(orderId);
    }
    this.#appendEvent(orderId, options.eventType || "order.provisioning.failed", {
      message,
      details,
    });
    return this.getOrder(orderId);
  }

  markOrderCanceled(orderId, reason = "") {
    const existing = this.getOrder(orderId);
    if (!existing) {
      return null;
    }
    if (existing.status === "running" || existing.status === "canceled") {
      return existing;
    }
    const statement = this.db.prepare(`
      UPDATE orders
      SET status = 'canceled', updated_at = ?, canceled_at = ?, error_message = ?
      WHERE id = ? AND status != 'running'
    `);
    const canceledAt = nowIso();
    const result = statement.run(canceledAt, canceledAt, reason || null, orderId);
    if (result.changes === 0) {
      return this.getOrder(orderId);
    }
    this.#appendEvent(orderId, "order.canceled", {
      reason: reason || null,
    });
    return this.getOrder(orderId);
  }
}
