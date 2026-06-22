// WebSocket connection manager
// Maintains per-user WebSocket connections for real-time message push

import { logger } from "./logger.ts";

// userId -> Set of active WebSocket connections (insertion order = oldest first)
const connections: Map<string, Set<WebSocket>> = new Map();

// Cap connections per user. Each WS holds its own kv.watch() subscription, so a
// misbehaving client that opens many sockets and never closes them would
// otherwise exhaust Deno KV's watch capacity and wedge the database (the root
// cause of the June 2026 outage). When a user exceeds the cap we close their
// OLDEST connections; closing fires onclose, which cancels that socket's watch.
const MAX_CONN_PER_USER = Number(Deno.env.get("WS_MAX_CONN_PER_USER") || "5");
// How often the reaper sweeps for non-OPEN sockets that never fired onclose.
const REAP_INTERVAL_MS = Number(Deno.env.get("WS_REAP_INTERVAL_MS") || "60000");
let reaper: ReturnType<typeof setInterval> | null = null;

/**
 * Register a WebSocket connection for a user. Enforces the per-user cap by
 * closing the oldest connections beyond MAX_CONN_PER_USER.
 */
export function addConnection(userId: string, ws: WebSocket): void {
  let userSockets = connections.get(userId);
  if (!userSockets) {
    userSockets = new Set();
    connections.set(userId, userSockets);
  }
  userSockets.add(ws);

  if (userSockets.size > MAX_CONN_PER_USER) {
    const closeCount = userSockets.size - MAX_CONN_PER_USER;
    const oldest: WebSocket[] = [];
    for (const s of userSockets) {
      if (s === ws) continue; // never evict the connection we just added
      oldest.push(s);
      if (oldest.length >= closeCount) break;
    }
    for (const s of oldest) {
      try {
        s.close(4001, "Too many connections for this session");
      } catch { /* ignore */ }
      userSockets.delete(s);
    }
    logger.warn("ws", "Per-user connection cap exceeded; closed oldest", {
      userId,
      cap: MAX_CONN_PER_USER,
      closed: oldest.length,
    });
  }

  logger.info("ws", "Connection added", { userId, total: userSockets.size });
}

/**
 * Unregister a WebSocket connection for a user.
 */
export function removeConnection(userId: string, ws: WebSocket): void {
  const userSockets = connections.get(userId);
  if (!userSockets) return;
  userSockets.delete(ws);
  if (userSockets.size === 0) {
    connections.delete(userId);
  }
  logger.info("ws", "Connection removed", {
    userId,
    total: userSockets?.size ?? 0,
  });
}

/**
 * Push a JSON message to all of a user's WebSocket connections.
 */
export function pushToUser(userId: string, message: unknown): void {
  const userSockets = connections.get(userId);
  if (!userSockets || userSockets.size === 0) {
    logger.warn(
      "ws",
      "No WebSocket connections for user — message will wait for poll",
      {
        userId,
        totalTrackedUsers: connections.size,
      },
    );
    return;
  }

  const data = JSON.stringify(message);
  let sent = 0;
  const dead: WebSocket[] = [];
  for (const ws of userSockets) {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
        sent++;
      } else {
        dead.push(ws);
      }
    } catch (err) {
      dead.push(ws);
      logger.error("ws", "Failed to send message", {
        userId,
        error: String(err),
      });
    }
  }
  // Close and drop any non-OPEN sockets we encountered, rather than just logging
  // them. Closing cancels their kv.watch; dropping frees the slot for the cap.
  for (const ws of dead) {
    try {
      ws.close();
    } catch { /* ignore */ }
    userSockets.delete(ws);
  }
  if (userSockets.size === 0) connections.delete(userId);
  logger.info("ws", "Pushed message to user", {
    userId,
    sent,
    reaped: dead.length,
    total: userSockets?.size ?? 0,
  });
}

/**
 * Get the number of active connections for a user.
 */
export function getConnectionCount(userId?: string): number {
  if (userId) return connections.get(userId)?.size ?? 0;
  let total = 0;
  for (const sockets of connections.values()) total += sockets.size;
  return total;
}

/**
 * Sweep all tracked connections and close/drop any that are no longer OPEN.
 * A connection whose onclose never fired (a half-open / zombie socket) would
 * otherwise sit in the map forever holding its kv.watch. Returns how many were
 * reaped. Safe to call on a timer.
 */
export function reapDeadConnections(): number {
  let reaped = 0;
  for (const [userId, userSockets] of connections) {
    for (const ws of userSockets) {
      if (ws.readyState !== WebSocket.OPEN) {
        try {
          ws.close();
        } catch { /* ignore */ }
        userSockets.delete(ws);
        reaped++;
      }
    }
    if (userSockets.size === 0) connections.delete(userId);
  }
  if (reaped > 0) {
    logger.info("ws", "Reaped dead connections", {
      reaped,
      remaining: getConnectionCount(),
    });
  }
  return reaped;
}

/** Start the periodic dead-connection reaper. Call once at startup. */
export function startConnectionReaper(): void {
  if (reaper) return;
  reaper = setInterval(reapDeadConnections, REAP_INTERVAL_MS);
}

/** Stop the reaper (for graceful shutdown / tests). */
export function stopConnectionReaper(): void {
  if (reaper) {
    clearInterval(reaper);
    reaper = null;
  }
}
