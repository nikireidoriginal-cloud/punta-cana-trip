const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const KV_KEY = 'spa-selections';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (url.pathname === '/api/spa' && request.method === 'GET') {
      const data = await env.SPA_DATA.get(KV_KEY);
      return new Response(data || '{}', { headers: CORS_HEADERS });
    }

    if (url.pathname === '/api/spa' && request.method === 'PUT') {
      const body = await request.text();
      await env.SPA_DATA.put(KV_KEY, body);
      return new Response(JSON.stringify({ ok: true }), { headers: CORS_HEADERS });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: CORS_HEADERS
    });
  }
};
