// Anonymous analytics endpoint — no personal data stored
// Stores: topic, age_band, salary_band, priority, product, timestamp

const AGE_BAND = age => {
  const a = parseInt(age);
  if(isNaN(a)) return 'unknown';
  if(a < 18) return 'under-18';
  if(a <= 21) return '18-21';
  if(a <= 25) return '22-25';
  if(a <= 29) return '26-29';
  if(a <= 34) return '30-34';
  return '35+';
};

const SALARY_BAND = salary => {
  const s = parseInt(salary);
  if(isNaN(s)) return 'unknown';
  if(s < 20000)  return 'under-20k';
  if(s < 25000)  return '20-25k';
  if(s < 30000)  return '25-30k';
  if(s < 35000)  return '30-35k';
  if(s < 45000)  return '35-45k';
  if(s < 60000)  return '45-60k';
  return '60k+';
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if(req.method === 'OPTIONS') return res.status(200).end();
  if(req.method !== 'POST') return res.status(405).end();

  try {
    const { topic, age, salary, priority, product } = req.body;

    const event = {
      topic:       topic        || 'unknown',
      product:     product      || 'isa',
      age_band:    AGE_BAND(age),
      salary_band: SALARY_BAND(salary),
      priority:    priority     || 'none',
      ts:          new Date().toISOString(),
    };

    // Log to Vercel function logs (free, no setup needed)
    // Replace with your analytics service later (Plausible, Mixpanel, etc.)
    console.log('SAVEISA_EVENT:', JSON.stringify(event));

    // If Vercel KV is available, store a daily counter per topic
    try {
      const { kv } = await import('@vercel/kv');
      const day = new Date().toISOString().slice(0, 10);
      await kv.hincrby(`stats:${day}`, topic, 1);
      await kv.hincrby(`stats:${day}:age`, event.age_band, 1);
      await kv.hincrby(`stats:${day}:salary`, event.salary_band, 1);
    } catch(_) {
      // KV not configured — logs only, that's fine
    }

    return res.status(200).json({ ok: true });
  } catch(err) {
    console.error('Track error:', err.message);
    return res.status(200).json({ ok: false }); // never block the user
  }
}
