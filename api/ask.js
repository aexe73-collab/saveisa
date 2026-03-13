export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { prompt } = req.body;

    const system = `You are a UK financial assistant for SaveISA. Respond with ONLY valid JSON, no preamble or markdown.

Use this structure:
{"what_is_it":"2-3 sentences","what_to_look_for":[{"summary":"title","detail":"explanation"},{"summary":"title","detail":"explanation"},{"summary":"title","detail":"explanation"}],"top_picks":[{"name":"name","rate":"figure","desc":"why it matters","url":"https://... or empty"},{"name":"name","rate":"figure","desc":"why","url":""},{"name":"name","rate":"figure","desc":"why","url":""}],"more_picks":[]}

Use 2024/25 UK tax rates. Be specific with figures. Speak directly to the user.`;

    const body = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
    };

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
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
