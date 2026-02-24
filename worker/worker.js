const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json'
};

const KV_KEY = 'spa-selections';
const SCHEDULE_KEY = 'schedule-html';
const CHANGELOG_KEY = 'schedule-changelog';
const PROPOSALS_KEY = 'feedback-proposals';
const NOTES_KEY = 'feedback-notes';

// Email recipients for change notifications
const NOTIFY_EMAILS = ['nikireidoriginal@gmail.com' /*, 'ferrellshatto@gmail.com' */];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // ── Spa selections ──
    if (url.pathname === '/api/spa' && request.method === 'GET') {
      const data = await env.SPA_DATA.get(KV_KEY);
      return new Response(data || '{}', { headers: CORS_HEADERS });
    }

    if (url.pathname === '/api/spa' && request.method === 'PUT') {
      const body = await request.text();
      await env.SPA_DATA.put(KV_KEY, body);
      return new Response(JSON.stringify({ ok: true }), { headers: CORS_HEADERS });
    }

    // ── Get current schedule override ──
    if (url.pathname === '/api/schedule' && request.method === 'GET') {
      const data = await env.SPA_DATA.get(SCHEDULE_KEY);
      return new Response(data || '{"html":""}', { headers: CORS_HEADERS });
    }

    // ── Get change log ──
    if (url.pathname === '/api/changelog' && request.method === 'GET') {
      const data = await env.SPA_DATA.get(CHANGELOG_KEY);
      return new Response(data || '{"entries":[]}', { headers: CORS_HEADERS });
    }

    // ── AI-powered schedule edit ──
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
        let updatedHtml = claudeData.content[0].text;

        // Strip code fences and <schedule> wrapper if Claude added them
        updatedHtml = updatedHtml.replace(/^```html?\n?/i, '').replace(/\n?```$/g, '');
        updatedHtml = updatedHtml.replace(/^<schedule>\n?/i, '').replace(/\n?<\/schedule>$/gi, '');
        updatedHtml = updatedHtml.trim();

        // Store updated schedule in KV
        await env.SPA_DATA.put(SCHEDULE_KEY, JSON.stringify({ html: updatedHtml }));

        // Append to change log
        const now = new Date().toISOString();
        const logRaw = await env.SPA_DATA.get(CHANGELOG_KEY);
        const log = logRaw ? JSON.parse(logRaw) : { entries: [] };
        log.entries.unshift({ what: instruction, time: now });
        if (log.entries.length > 50) log.entries = log.entries.slice(0, 50);
        await env.SPA_DATA.put(CHANGELOG_KEY, JSON.stringify(log));

        // Send email notification — use waitUntil so it completes after response
        if (env.RESEND_API_KEY) {
          ctx.waitUntil(sendNotificationEmail(env, instruction, now));
        }

        return new Response(JSON.stringify({ ok: true, html: updatedHtml, instruction }), {
          headers: CORS_HEADERS
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: 'Server error', details: err.message }), {
          status: 500, headers: CORS_HEADERS
        });
      }
    }

    // ── Feedback: Proposals ──
    if (url.pathname === '/api/proposals' && request.method === 'GET') {
      const data = await env.SPA_DATA.get(PROPOSALS_KEY);
      return new Response(data || '[]', { headers: CORS_HEADERS });
    }

    if (url.pathname === '/api/proposals' && request.method === 'POST') {
      const { text } = await request.json();
      if (!text || !text.trim()) {
        return new Response(JSON.stringify({ error: 'Empty text' }), { status: 400, headers: CORS_HEADERS });
      }
      const raw = await env.SPA_DATA.get(PROPOSALS_KEY);
      const list = raw ? JSON.parse(raw) : [];
      const entry = { text: text.trim(), date: new Date().toISOString(), id: Date.now() };
      list.unshift(entry);
      if (list.length > 100) list.length = 100;
      await env.SPA_DATA.put(PROPOSALS_KEY, JSON.stringify(list));
      return new Response(JSON.stringify(list), { headers: CORS_HEADERS });
    }

    if (url.pathname.startsWith('/api/proposals/') && request.method === 'DELETE') {
      const id = Number(url.pathname.split('/').pop());
      const raw = await env.SPA_DATA.get(PROPOSALS_KEY);
      const list = raw ? JSON.parse(raw) : [];
      const updated = list.filter(p => p.id !== id);
      await env.SPA_DATA.put(PROPOSALS_KEY, JSON.stringify(updated));
      return new Response(JSON.stringify(updated), { headers: CORS_HEADERS });
    }

    // ── Feedback: Notes ──
    if (url.pathname === '/api/notes' && request.method === 'GET') {
      const data = await env.SPA_DATA.get(NOTES_KEY);
      return new Response(data || '[]', { headers: CORS_HEADERS });
    }

    if (url.pathname === '/api/notes' && request.method === 'POST') {
      const { text } = await request.json();
      if (!text || !text.trim()) {
        return new Response(JSON.stringify({ error: 'Empty text' }), { status: 400, headers: CORS_HEADERS });
      }
      const raw = await env.SPA_DATA.get(NOTES_KEY);
      const list = raw ? JSON.parse(raw) : [];
      const entry = { text: text.trim(), date: new Date().toISOString(), id: Date.now() };
      list.unshift(entry);
      if (list.length > 100) list.length = 100;
      await env.SPA_DATA.put(NOTES_KEY, JSON.stringify(list));
      return new Response(JSON.stringify(list), { headers: CORS_HEADERS });
    }

    if (url.pathname.startsWith('/api/notes/') && request.method === 'DELETE') {
      const id = Number(url.pathname.split('/').pop());
      const raw = await env.SPA_DATA.get(NOTES_KEY);
      const list = raw ? JSON.parse(raw) : [];
      const updated = list.filter(n => n.id !== id);
      await env.SPA_DATA.put(NOTES_KEY, JSON.stringify(updated));
      return new Response(JSON.stringify(updated), { headers: CORS_HEADERS });
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: CORS_HEADERS
    });
  }
};

async function sendNotificationEmail(env, instruction, time) {
  const d = new Date(time);
  const timeStr = d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + env.RESEND_API_KEY
    },
    body: JSON.stringify({
      from: 'Punta Cana Trip <trips@reidshatto.com>',
      to: NOTIFY_EMAILS,
      subject: 'Changes made to Punta Cana schedule',
      html: '<div style="font-family:sans-serif;max-width:480px;">'
        + '<h2 style="color:#5B8A8A;">Punta Cana Schedule Updated</h2>'
        + '<p><strong>Change:</strong> ' + instruction + '</p>'
        + '<p><strong>When:</strong> ' + timeStr + ' ET</p>'
        + '<p><a href="https://nikireidoriginal-cloud.github.io/punta-cana-trip/" style="color:#5B8A8A;">View updated schedule &rarr;</a></p>'
        + '</div>'
    })
  });

  if (!res.ok) {
    console.error('Email failed:', await res.text());
  }
}
