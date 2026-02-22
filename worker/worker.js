const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const KV_KEY = 'spa-selections';
const COMMENTS_KEY = 'schedule-comments';
const SCHEDULE_KEY = 'schedule-html';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // ── Existing: spa selections ──
    if (url.pathname === '/api/spa' && request.method === 'GET') {
      const data = await env.SPA_DATA.get(KV_KEY);
      return new Response(data || '{}', { headers: CORS_HEADERS });
    }

    if (url.pathname === '/api/spa' && request.method === 'PUT') {
      const body = await request.text();
      await env.SPA_DATA.put(KV_KEY, body);
      return new Response(JSON.stringify({ ok: true }), { headers: CORS_HEADERS });
    }

    // ── Existing: comments ──
    if (url.pathname === '/api/comments' && request.method === 'GET') {
      const data = await env.SPA_DATA.get(COMMENTS_KEY);
      return new Response(data || '{"text":""}', { headers: CORS_HEADERS });
    }

    if (url.pathname === '/api/comments' && request.method === 'PUT') {
      const body = await request.text();
      await env.SPA_DATA.put(COMMENTS_KEY, body);
      return new Response(JSON.stringify({ ok: true }), { headers: CORS_HEADERS });
    }

    // ── New: get current schedule override ──
    if (url.pathname === '/api/schedule' && request.method === 'GET') {
      const data = await env.SPA_DATA.get(SCHEDULE_KEY);
      return new Response(data || '{"html":""}', { headers: CORS_HEADERS });
    }

    // ── New: AI-powered schedule edit ──
    if (url.pathname === '/api/ai-edit' && request.method === 'POST') {
      try {
        const { instruction, currentHtml } = await request.json();

        if (!instruction || !currentHtml) {
          return new Response(JSON.stringify({ error: 'Missing instruction or currentHtml' }), {
            status: 400, headers: CORS_HEADERS
          });
        }

        // Call Claude API
        const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 4096,
            messages: [{
              role: 'user',
              content: `You are editing a vacation schedule for a Punta Cana trip. The schedule is HTML.

Here is the current schedule HTML:

<schedule>
${currentHtml}
</schedule>

The user wants to make this change: "${instruction}"

Return ONLY the updated HTML — the complete schedule section with the change applied. Do not add any explanation, markdown, or code fences. Return raw HTML only.

Important rules:
- Keep all existing CSS classes (tl-row, tl-time, tl-event, tl-family, tl-niki, tl-ferrell, tl-logistics, night-tag, morning-tag, etc.)
- Keep all HTML entities (&rarr; &middot; &rsquo; &ndash; &mdash; etc.)
- Only change what the user asked for
- If you're unsure what they mean, make your best reasonable interpretation`
            }]
          })
        });

        if (!claudeResponse.ok) {
          const errText = await claudeResponse.text();
          return new Response(JSON.stringify({ error: 'Claude API error', details: errText }), {
            status: 502, headers: CORS_HEADERS
          });
        }

        const claudeData = await claudeResponse.json();
        const updatedHtml = claudeData.content[0].text;

        // Store in KV
        await env.SPA_DATA.put(SCHEDULE_KEY, JSON.stringify({ html: updatedHtml, lastEdit: instruction, updatedAt: new Date().toISOString() }));

        return new Response(JSON.stringify({ ok: true, html: updatedHtml, instruction }), {
          headers: CORS_HEADERS
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Server error', details: err.message }), {
          status: 500, headers: CORS_HEADERS
        });
      }
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: CORS_HEADERS
    });
  }
};
