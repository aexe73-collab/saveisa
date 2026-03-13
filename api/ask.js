import { kv } from '@vercel/kv';

const CACHEABLE = new Set(['cash-isa','lifetime-isa','credit-cards','personal-loans','consolidate','auto-enrolment','state-pension','student-loan']);
const CACHE_TTL = {'cash-isa':14400,'lifetime-isa':86400,'credit-cards':14400,'personal-loans':14400,'consolidate':86400,'auto-enrolment':86400,'state-pension':86400,'student-loan':86400};

function cacheKey(topic, priority){
  const d = new Date().toISOString().slice(0,10);
  return `saveisa:${topic}:${(priority||'default').replace(/\s+/g,'-').toLowerCase()}:${d}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS') return res.status(200).end();
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});

  const { topic, priority, ...rest } = req.body;

  // Cache check
  if(topic && CACHEABLE.has(topic)){
    try {
      const key = cacheKey(topic, priority);
      const hit = await kv.get(key);
      if(hit){
        console.log('Cache HIT:', key);
        res.setHeader('X-Cache','HIT');
        return res.status(200).json({content:[{type:'text',text:hit}]});
      }
    } catch(e){ console.warn('KV unavailable:', e.message); }
  }

  const body = {
    ...rest,
    model: 'claude-sonnet-4-5',
    system: 'You are a UK financial information assistant. You MUST respond with ONLY a valid JSON object — no preamble, no explanation, no markdown, no code fences. Your entire response must be parseable by JSON.parse(). Start your response with { and end with }. Never write sentences before or after the JSON.',
    tools: [{type:'web_search_20250305',name:'web_search'}],
    stream: true,
  };

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version':'2023-06-01',
        'anthropic-beta':'web-search-2025-03-05',
      },
      body: JSON.stringify(body),
    });

    if(!upstream.ok){
      const err = await upstream.json();
      console.error('Anthropic error:', JSON.stringify(err));
      return res.status(upstream.status).json(err);
    }

    res.setHeader('Content-Type','text/event-stream');
    res.setHeader('Cache-Control','no-cache');
    res.setHeader('X-Cache','MISS');

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let buf = '';

    while(true){
      const {done, value} = await reader.read();
      if(done) break;
      buf += decoder.decode(value,{stream:true});
      const lines = buf.split('\n');
      buf = lines.pop();

      for(const line of lines){
        if(!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if(raw==='[DONE]') continue;
        try {
          const evt = JSON.parse(raw);
          if(evt.type==='content_block_delta' && evt.delta?.type==='text_delta'){
            fullText += evt.delta.text;
            res.write(`data: ${JSON.stringify({chunk:evt.delta.text})}\n\n`);
          }
          if(evt.type==='content_block_start' && evt.content_block?.type==='tool_use'){
            res.write(`data: ${JSON.stringify({searching:true})}\n\n`);
          }
          if(evt.type==='message_stop'){
            res.write(`data: ${JSON.stringify({done:true})}\n\n`);
          }
        } catch(_){}
      }
    }
    res.end();

    // Write to cache after stream completes
    if(topic && CACHEABLE.has(topic) && fullText.includes('{')){
      try {
        const key = cacheKey(topic, priority);
        await kv.set(key, fullText, {ex: CACHE_TTL[topic]||14400});
        console.log('Cached:', key);
      } catch(e){ console.warn('Cache write failed:', e.message); }
    }

  } catch(err){
    console.error('Handler error:', err.message);
    if(!res.headersSent) return res.status(500).json({error:{message:err.message}});
    res.write(`data: ${JSON.stringify({error:err.message})}\n\n`);
    res.end();
  }
}
