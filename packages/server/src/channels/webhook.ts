// Generic webhook channel handler
// Receives HTTP webhooks from external services and stores them as messages

import { addMessage, type StoredMessage } from '../store.ts';
import { getSessionByChannelId } from '../auth.ts';

export async function handleWebhook(
  channelId: string,
  req: Request,
): Promise<Response> {
  // Look up the channel owner
  const session = getSessionByChannelId(channelId);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unknown channel' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Find the channel config to verify it's a webhook type
  const channel = session.channels.find((ch) => ch.id === channelId);
  if (!channel || channel.type !== 'webhook') {
    return new Response(JSON.stringify({ error: 'Channel is not a webhook' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify the secret token from query params
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  const expectedToken = channel.metadata?.['webhookSecret'] as string | undefined;
  if (expectedToken && token !== expectedToken) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Parse the payload
  let content: string;
  let metadata: Record<string, unknown> = {};
  const contentType = req.headers.get('Content-Type') || '';

  try {
    if (contentType.includes('application/json')) {
      const body = await req.json();
      content = typeof body === 'string' ? body : JSON.stringify(body);
      metadata = { raw: body };
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await req.formData();
      const entries: Record<string, string> = {};
      for (const [key, value] of formData.entries()) {
        entries[key] = String(value);
      }
      content = JSON.stringify(entries);
      metadata = { form: entries };
    } else {
      content = await req.text();
      metadata = { raw: content };
    }
  } catch {
    content = await req.text().catch(() => '(empty body)');
  }

  // Store the message
  const message: StoredMessage = {
    id: crypto.randomUUID(),
    userId: session.userId,
    channelType: 'webhook',
    channelId,
    from: req.headers.get('X-Webhook-Source') || 'webhook',
    content,
    timestamp: new Date().toISOString(),
    metadata,
  };

  addMessage(session.userId, message);

  return new Response(JSON.stringify({ ok: true, messageId: message.id }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
