export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = {
      ...req.body,
      model: 'claude-sonnet-4-5',
      system: 'You are a UK financial information assistant. You MUST respond with ONLY a valid JSON object — no preamble, no explanation, no markdown, no code fences. Your entire response must be parseable by JSON.parse(). Start your response with { and end with }. Never write sentences before or after the JSON.',
      tools: [{ type: 'web_search_20250305', name: 'web_search' }]
    };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05'
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Anthropic API error:', JSON.stringify(data));
    }

    return res.status(response.status).json(data);
  } catch (err) {
    console.error('Handler error:', err.message);
    return res.status(500).json({ error: { message: err.message } });
  }
}
