// WebSocket connection manager
// Maintains per-user WebSocket connections for real-time message push

import { logger } from './logger.ts';

// userId -> Set of active WebSocket connections
const connections: Map<string, Set<WebSocket>> = new Map();

/**
 * Register a WebSocket connection for a user.
 */
export function addConnection(userId: string, ws: WebSocket): void {
  let userSockets = connections.get(userId);
  if (!userSockets) {
    userSockets = new Set();
    connections.set(userId, userSockets);
  }
  userSockets.add(ws);
  logger.info('ws', 'Connection added', { userId, total: userSockets.size });
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
  logger.info('ws', 'Connection removed', { userId, total: userSockets?.size ?? 0 });
}

/**
 * Push a JSON message to all of a user's WebSocket connections.
 */
export function pushToUser(userId: string, message: unknown): void {
  const userSockets = connections.get(userId);
  if (!userSockets || userSockets.size === 0) return;

  const data = JSON.stringify(message);
  for (const ws of userSockets) {
    try {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    } catch (err) {
      logger.error('ws', 'Failed to send message', { userId, error: String(err) });
    }
  }
  logger.debug('ws', 'Pushed message to user', { userId, connections: userSockets.size });
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
