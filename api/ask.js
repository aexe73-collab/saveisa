// Topics that need live rates via web search
const SEARCH_TOPICS = new Set([
  'cash-isa', 'lifetime-isa', 'emergency-fund',
  'credit-cards', 'personal-loans', 'mortgage', 'consolidate'
]);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { topic, prompt } = req.body;
    const useSearch = SEARCH_TOPICS.has(topic);

    const system = `You are a UK financial information assistant for SaveISA, a free tool helping 18-24 year olds understand money.

CRITICAL: Respond with ONLY a valid JSON object. No preamble, no markdown, no code fences. Start with { and end with }.

Always use this exact structure:
{
  "what_is_it": "2-3 plain English sentences summarising the key insight for this user",
  "what_to_look_for": [
    {"summary": "Short title", "detail": "1-2 sentence explanation"},
    {"summary": "Short title", "detail": "1-2 sentence explanation"},
    {"summary": "Short title", "detail": "1-2 sentence explanation"}
  ],
  "top_picks": [
    {"name": "Provider or concept name", "rate": "Key figure e.g. 5.1% AER or £2,173/mo", "desc": "Why this matters for this user", "url": "https://... or empty string"},
    {"name": "Provider or concept name", "rate": "Key figure", "desc": "Why this matters", "url": ""},
    {"name": "Provider or concept name", "rate": "Key figure", "desc": "Why this matters", "url": ""}
  ],
  "more_picks": []
}

Rules:
- All figures must be accurate for 2024/25 tax year
- Speak directly to the user, not about them
- For info topics (payslip, student loan, auto-enrolment, salary-sacrifice, state-pension) top_picks should be key facts/figures with empty url
- Keep desc fields under 20 words each`;

    const body = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
      ...(useSearch && { tools: [{ type: 'web_search_20250305', name: 'web_search' }] }),
    };

    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      ...(useSearch && { 'anthropic-beta': 'web-search-2025-03-05' }),
    };

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!upstream.ok) {
      const err = await upstream.json();
      console.error('Anthropic error:', JSON.stringify(err));
      return res.status(upstream.status).json(err);
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-Accel-Buffering', 'no');

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') continue;
        try {
          const evt = JSON.parse(raw);
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
            res.write(`data: ${JSON.stringify({ chunk: evt.delta.text })}\n\n`);
          }
          if (evt.type === 'content_block_start' && evt.content_block?.type === 'tool_use') {
            res.write(`data: ${JSON.stringify({ searching: true })}\n\n`);
          }
          if (evt.type === 'message_stop') {
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
          }
        } catch (_) {}
      }
    }

    res.end();

  } catch (err) {
    console.error('Handler error:', err.message);
    if (!res.headersSent) return res.status(500).json({ error: { message: err.message } });
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
}
