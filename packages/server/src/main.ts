// CHAOS Relay Server
// Handles message relay between external channels and the Chrome extension

const PORT = parseInt(Deno.env.get('PORT') || '8787');

Deno.serve({ port: PORT }, async (_req: Request) => {
  const url = new URL(_req.url);

  // Health check
  if (url.pathname === '/health') {
    return new Response(JSON.stringify({ status: 'ok', version: '0.0.1' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // TODO: Auth middleware
  // TODO: Channel webhook endpoints
  // TODO: Polling endpoint for extension
  // TODO: Reply endpoint

  return new Response('CHAOS Relay Server', { status: 200 });
});

console.log(`CHAOS relay server running on port ${PORT}`);
