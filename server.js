// Truman on Call — backend
// Serves the game and powers the sponsor integrations. Every integration is optional:
// if its env vars are missing, /api/health reports it off and the game hides that feature.
import 'dotenv/config';
import express from 'express';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction,
  sendAndConfirmTransaction, clusterApiUrl, LAMPORTS_PER_SOL
} from '@solana/web3.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
const app = express();
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const clean = (s, n = 40) => String(s ?? '').replace(/[^\p{L}\p{N} _.'-]/gu, '').slice(0, n);

/* ---------------- Tiger Data (TimescaleDB) ---------------- */
let pool = null;
if (env.DATABASE_URL) {
  pool = new pg.Pool({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5 });
  // Continuous aggregates can't be created inside a transaction, so run statements one by one.
  const sql = fs.readFileSync(path.join(__dirname, 'db/schema.sql'), 'utf8')
    .split(/;\s*$/m).map(s => s.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean);
  (async () => {
    for (const stmt of sql) {
      try { await pool.query(stmt); } catch (e) { console.warn('[db] schema:', e.message.split('\n')[0]); }
    }
    console.log('[db] Tiger Data ready');
  })();
}
const db = (q, p) => pool ? pool.query(q, p) : Promise.reject(new Error('no db'));

app.post('/api/event', async (req, res) => {
  if (!pool) return res.json({ ok: false });
  const { player, level, step, card, zone, correct, ms } = req.body || {};
  try {
    await db('INSERT INTO answers(player,level,step,card,zone,correct,ms) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [clean(player), clean(level), step | 0, clean(card), clean(zone), !!correct, Math.min(ms | 0, 600000)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false }); }
});

app.post('/api/cpr', async (req, res) => {
  if (!pool) return res.json({ ok: false });
  const { player, session, taps, source } = req.body || {};
  const src = ['tap', 'motion', 'cam', 'serial'].includes(source) ? source : 'tap';
  if (!Array.isArray(taps) || taps.length < 2 || taps.length > 200) return res.status(400).json({ ok: false });
  const rows = [];
  for (let i = 1; i < taps.length; i++) {
    const iv = taps[i] - taps[i - 1];
    if (iv > 0 && iv < 5000) rows.push([new Date(taps[i]), clean(player), clean(session), Math.round(iv), 60000 / iv, src]);
  }
  if (!rows.length) return res.json({ ok: true, n: 0 });
  const vals = rows.map((_, i) => `($${i * 6 + 1},$${i * 6 + 2},$${i * 6 + 3},$${i * 6 + 4},$${i * 6 + 5},$${i * 6 + 6})`).join(',');
  try {
    await db(`INSERT INTO compressions(ts,player,session_id,interval_ms,bpm,source) VALUES ${vals}`, rows.flat());
    res.json({ ok: true, n: rows.length });
  } catch (e) { res.status(500).json({ ok: false }); }
});

app.post('/api/session', async (req, res) => {
  if (!pool) return res.json({ ok: false });
  const { player, level, score, stars } = req.body || {};
  try {
    await db('INSERT INTO sessions(player,level,score,stars) VALUES($1,$2,$3,$4)',
      [clean(player), clean(level), Math.min(score | 0, 100000), Math.min(stars | 0, 3)]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false }); }
});

app.get('/api/leaderboard', async (_req, res) => {
  if (!pool) return res.json({ rows: [] });
  try {
    const { rows } = await db(`
      SELECT player, SUM(best)::int AS score, SUM(stars)::int AS stars FROM (
        SELECT player, level, MAX(score) AS best, MAX(stars) AS stars
        FROM sessions WHERE player <> '' GROUP BY player, level) t
      GROUP BY player ORDER BY score DESC LIMIT 10`);
    res.json({ rows });
  } catch (e) { res.json({ rows: [] }); }
});

// "What do people get wrong?" - reads the continuous aggregates.
app.get('/api/insights', async (_req, res) => {
  if (!pool) return res.json({});
  try {
    const [myths, levels, cpr, bySource] = await Promise.all([
      db(`SELECT level, card, SUM(n)::int AS times FROM answers_hourly
          WHERE NOT correct AND card <> '' AND bucket > now() - INTERVAL '7 days'
          GROUP BY level, card ORDER BY times DESC LIMIT 5`),
      db(`SELECT level, ROUND(100.0 * SUM(n) FILTER (WHERE correct) / NULLIF(SUM(n),0))::int AS accuracy,
                 ROUND(SUM(avg_ms * n) / NULLIF(SUM(n),0) / 1000.0, 1)::float AS avg_sec, SUM(n)::int AS answers
          FROM answers_hourly GROUP BY level ORDER BY accuracy ASC`),
      db(`SELECT SUM(pushes)::int AS pushes, ROUND(SUM(avg_bpm * pushes) / NULLIF(SUM(pushes),0))::int AS avg_bpm,
                 ROUND(100 * SUM(in_zone * pushes) / NULLIF(SUM(pushes),0))::int AS in_zone
          FROM cpr_minutely WHERE bucket > now() - INTERVAL '1 day'`),
      db(`SELECT COALESCE(source,'tap') AS source, count(*)::int AS pushes, ROUND(avg(bpm))::int AS avg_bpm,
                 ROUND(100 * avg(CASE WHEN bpm BETWEEN 100 AND 120 THEN 1.0 ELSE 0.0 END))::int AS in_zone
          FROM compressions WHERE ts > now() - INTERVAL '7 days' GROUP BY 1 ORDER BY 2 DESC`)
    ]);
    res.json({ myths: myths.rows, levels: levels.rows, cpr: cpr.rows[0] || {}, bySource: bySource.rows });
  } catch (e) { console.warn('[db] insights', e.message); res.json({}); }
});

/* ---------------- Coach Pulse: Snowflake Cortex or Gemini ---------------- */
const chatProvider = () => {
  const want = (env.CHAT_PROVIDER || 'snowflake').toLowerCase();
  if (want === 'snowflake' && env.SNOWFLAKE_ACCOUNT && env.SNOWFLAKE_PAT) return 'snowflake';
  if (want === 'gemini' && env.GEMINI_API_KEY) return 'gemini';
  if (env.SNOWFLAKE_ACCOUNT && env.SNOWFLAKE_PAT) return 'snowflake';
  if (env.GEMINI_API_KEY) return 'gemini';
  return null;
};

async function askSnowflake(system, messages) {
  const host = env.SNOWFLAKE_ACCOUNT.includes('snowflakecomputing.com') ? env.SNOWFLAKE_ACCOUNT : `${env.SNOWFLAKE_ACCOUNT}.snowflakecomputing.com`;
  // Cortex Chat Completions API (OpenAI-compatible)
  const r = await fetch(`https://${host}/api/v2/cortex/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.SNOWFLAKE_PAT}` },
    body: JSON.stringify({ model: env.SNOWFLAKE_MODEL || 'claude-3-5-sonnet', messages: [{ role: 'system', content: system }, ...messages], max_completion_tokens: 400 })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(j).slice(0, 300));
  return j.choices?.[0]?.message?.content ?? '';
}

async function askGemini(system, messages) {
  const model = env.GEMINI_MODEL || 'gemini-2.5-flash';
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
    })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(j).slice(0, 300));
  return j.candidates?.[0]?.content?.parts?.map(p => p.text).join('') ?? '';
}

app.post('/api/chat', async (req, res) => {
  const p = chatProvider();
  if (!p) return res.status(503).json({ error: 'no chat provider configured' });
  const { system = '', messages = [] } = req.body || {};
  const msgs = messages.slice(-10).filter(m => m && typeof m.content === 'string')
    .map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content.slice(0, 2000) }));
  try {
    const reply = p === 'snowflake' ? await askSnowflake(String(system).slice(0, 4000), msgs) : await askGemini(String(system).slice(0, 4000), msgs);
    res.json({ reply, provider: p });
  } catch (e) { console.warn('[chat]', e.message); res.status(502).json({ error: 'chat failed' }); }
});

/* ---------------- ElevenLabs: Truman's voice ---------------- */
const voiceCache = new Map(); // same line → same audio, saves credits during demos
app.post('/api/voice', async (req, res) => {
  if (!env.ELEVENLABS_API_KEY) return res.status(503).end();
  const text = String(req.body?.text || '').slice(0, 400);
  if (!text) return res.status(400).end();
  try {
    let buf = voiceCache.get(text);
    if (!buf) {
      const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB'}?output_format=mp3_44100_128`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'xi-api-key': env.ELEVENLABS_API_KEY, Accept: 'audio/mpeg' },
        body: JSON.stringify({ text, model_id: env.ELEVENLABS_MODEL || 'eleven_flash_v2_5', voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.35 } })
      });
      if (!r.ok) throw new Error(await r.text());
      buf = Buffer.from(await r.arrayBuffer());
      if (voiceCache.size > 300) voiceCache.clear();
      voiceCache.set(text, buf);
    }
    res.set('Content-Type', 'audio/mpeg').send(buf);
  } catch (e) { console.warn('[voice]', e.message.slice(0, 200)); res.status(502).end(); }
});

/* ---------------- Solana: verifiable training certificates ---------------- */
const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
let solana = null;
if (env.SOLANA_SECRET_KEY) {
  try {
    const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(env.SOLANA_SECRET_KEY)));
    const cluster = env.SOLANA_CLUSTER || 'devnet';
    solana = { kp, cluster, conn: new Connection(clusterApiUrl(cluster), 'confirmed') };
    console.log('[solana] issuer', kp.publicKey.toBase58(), 'on', cluster);
    solana.conn.getBalance(kp.publicKey).then(b => console.log('[solana] balance', b / LAMPORTS_PER_SOL, 'SOL')).catch(() => {});
  } catch (e) { console.warn('[solana] bad SOLANA_SECRET_KEY', e.message); }
}
const recentCerts = new Map();
app.post('/api/certificate', async (req, res) => {
  if (!solana) return res.status(503).json({ error: 'solana not configured' });
  const { player, level, stars, score } = req.body || {};
  const name = clean(player, 30);
  if (!name) return res.status(400).json({ error: 'name required' });
  const key = `${name}|${level}`;
  if (Date.now() - (recentCerts.get(key) || 0) < 30000) return res.status(429).json({ error: 'slow down' });
  recentCerts.set(key, Date.now());
  const record = { app: 'TrumanOnCall', v: 1, player: name, skill: clean(level), stars: Math.min(stars | 0, 3), score: score | 0, guideline: 'AHA 2025', at: new Date().toISOString() };
  try {
    const tx = new Transaction().add(new TransactionInstruction({
      keys: [{ pubkey: solana.kp.publicKey, isSigner: true, isWritable: true }],
      programId: MEMO_PROGRAM,
      data: Buffer.from(JSON.stringify(record), 'utf8')
    }));
    const signature = await sendAndConfirmTransaction(solana.conn, tx, [solana.kp]);
    const q = solana.cluster === 'mainnet-beta' ? '' : `?cluster=${solana.cluster}`;
    res.json({ signature, url: `https://explorer.solana.com/tx/${signature}${q}`, record });
  } catch (e) { console.warn('[solana]', e.message); res.status(502).json({ error: 'mint failed' }); }
});

/* ---------------- health ---------------- */
app.get('/api/health', (_req, res) => res.json({
  ok: true, chat: chatProvider(), voice: !!env.ELEVENLABS_API_KEY, db: !!pool, solana: !!solana
}));

const port = env.PORT || 3000;
app.listen(port, () => console.log(`Truman on Call running on http://localhost:${port}`));
