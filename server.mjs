import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pg from 'pg';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { Pool } = pg;
const app = express();
const port = Number(process.env.PORT || 3000);
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined });
const cookieName = 'clarity_session';
const sessionDays = 14;
const cookieSecure = process.env.NODE_ENV === 'production';
const openAiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const pistonUrl = process.env.PISTON_API_URL?.replace(/\/$/, '');

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '16kb' }));
app.use((req, _res, next) => { req.body ||= {}; next(); });
app.use(express.static(path.dirname(fileURLToPath(import.meta.url)), { index: false, maxAge: '1h' }));

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS problems (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL CHECK (subject IN ('Math','Coding')),
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS problems_user_date_idx ON problems(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS practice_sets (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  questions JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS practice_user_date_idx ON practice_sets(user_id, created_at DESC);
`;

const tutorInstructions = `You are Clarity, a patient tutor for beginner mathematics and programming. Use plain language, small numbered steps, and show how to check the result. For math, make calculations explicit. For code, explain the key idea and show a short example. Ask one concise follow-up if essential details are missing. Never claim code was executed unless it actually was.`;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const safeUser = row => ({ id: row.id, name: row.name, email: row.email });
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function cookie(res, value, maxAge) {
  res.append('Set-Cookie', `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${cookieSecure ? '; Secure' : ''}`);
}
function clearCookie(res) { cookie(res, '', 0); }
function parseCookie(req, name) {
  const item = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : null;
}
function requireUser(req, res, next) {
  (async () => {
  const token = parseCookie(req, cookieName);
  if (!token) return res.status(401).json({ error: 'Sign in to use this feature.' });
  const result = await pool.query(`SELECT u.id,u.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW()`, [hash(token)]);
  if (!result.rowCount) { clearCookie(res); return res.status(401).json({ error: 'Your session expired. Please sign in again.' }); }
  req.user = result.rows[0];
  next();
  })().catch(next);
}
function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (err, key) => err ? reject(err) : resolve(`${salt}:${key.toString('hex')}`)));
}
async function verifyPassword(password, stored) {
  const [salt, keyHex] = stored.split(':');
  const actual = await passwordHash(password, salt);
  const a = Buffer.from(actual.split(':')[1], 'hex'), b = Buffer.from(keyHex, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
async function createSession(userId, res) {
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,NOW()+($3 * INTERVAL \'1 day\'))', [hash(token), userId, sessionDays]);
  cookie(res, token, sessionDays * 24 * 60 * 60);
}
async function askAI(instructions, input, maxOutput = 900) {
  if (!openAiKey) { const error = new Error('AI is not configured. Add OPENAI_API_KEY in Render environment settings.'); error.status = 503; throw error; }
  const result = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { authorization: `Bearer ${openAiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, instructions, input, max_output_tokens: maxOutput, store: false }), signal: AbortSignal.timeout(45_000) });
  const payload = await result.json().catch(() => ({}));
  if (!result.ok) { const error = new Error(payload.error?.message || 'The AI service could not answer right now.'); error.status = result.status === 429 ? 429 : 502; throw error; }
  const text = (payload.output || []).flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('\n').trim();
  if (!text) { const error = new Error('The tutor returned an empty answer. Please try again.'); error.status = 502; throw error; }
  return text;
}

app.get('/api/health', asyncRoute(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ ok: true, aiConfigured: Boolean(openAiKey), codeRunnerConfigured: Boolean(pistonUrl) });
}));

app.post('/api/auth/register', rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false }), asyncRoute(async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 60);
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (name.length < 2) return res.status(400).json({ error: 'Enter a name with at least 2 characters.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password.length < 10 || password.length > 128) return res.status(400).json({ error: 'Use a password between 10 and 128 characters.' });
  const user = { id: crypto.randomUUID(), name, email, passwordHash: await passwordHash(password) };
  try { await pool.query('INSERT INTO users(id,name,email,password_hash) VALUES($1,$2,$3,$4)', [user.id, name, email, user.passwordHash]); }
  catch (err) { if (err.code === '23505') return res.status(409).json({ error: 'An account with that email already exists.' }); throw err; }
  await createSession(user.id, res);
  res.status(201).json({ user: safeUser(user) });
}));

app.post('/api/auth/login', rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false }), asyncRoute(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const found = await pool.query('SELECT id,name,email,password_hash FROM users WHERE email=$1', [email]);
  if (!found.rowCount || !(await verifyPassword(password, found.rows[0].password_hash))) return res.status(401).json({ error: 'Email or password is incorrect.' });
  await createSession(found.rows[0].id, res);
  res.json({ user: safeUser(found.rows[0]) });
}));

app.post('/api/auth/logout', asyncRoute(async (req, res) => {
  const token = parseCookie(req, cookieName);
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash=$1', [hash(token)]);
  clearCookie(res); res.json({ ok: true });
}));
app.get('/api/auth/me', asyncRoute(async (req, res) => {
  const token = parseCookie(req, cookieName);
  if (!token) return res.json({ user: null });
  const result = await pool.query('SELECT u.id,u.name,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>NOW()', [hash(token)]);
  res.json({ user: result.rowCount ? safeUser(result.rows[0]) : null });
}));

app.get('/api/dashboard', requireUser, asyncRoute(async (req, res) => {
  const [history, stats, practice] = await Promise.all([
    pool.query('SELECT id,subject,question,answer,created_at FROM problems WHERE user_id=$1 ORDER BY created_at DESC LIMIT 8', [req.user.id]),
    pool.query(`SELECT COUNT(*) FILTER (WHERE created_at >= date_trunc('week',NOW()))::int AS week_count, COUNT(*)::int AS total FROM problems WHERE user_id=$1`, [req.user.id]),
    pool.query('SELECT COUNT(*)::int AS total FROM practice_sets WHERE user_id=$1', [req.user.id])
  ]);
  const count = stats.rows[0].week_count;
  res.json({ user: safeUser(req.user), history: history.rows, progress: { thisWeek: count, minutes: count * 12, total: stats.rows[0].total, practiceSets: practice.rows[0].total, weeklyGoal: 6, percent: Math.min(100, Math.round(count / 6 * 100)) } });
}));

app.post('/api/solve', requireUser, rateLimit({ windowMs: 60_000, limit: 12, standardHeaders: true, legacyHeaders: false }), asyncRoute(async (req, res) => {
  const question = typeof req.body.question === 'string' ? req.body.question.trim() : '';
  const subject = req.body.subject === 'Coding' ? 'Coding' : 'Math';
  if (question.length < 3 || question.length > 4_000) return res.status(400).json({ error: 'Questions must be between 3 and 4,000 characters.' });
  const answer = await askAI(`${tutorInstructions}\nThe learner selected ${subject}. If another subject fits better, note that briefly and help anyway.`, question);
  const id = crypto.randomUUID();
  const saved = await pool.query('INSERT INTO problems(id,user_id,subject,question,answer) VALUES($1,$2,$3,$4,$5) RETURNING id,subject,question,answer,created_at', [id, req.user.id, subject, question, answer]);
  res.status(201).json(saved.rows[0]);
}));

app.delete('/api/problems/:id', requireUser, asyncRoute(async (req, res) => {
  const result = await pool.query('DELETE FROM problems WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
  if (!result.rowCount) return res.status(404).json({ error: 'Problem not found.' });
  res.json({ ok: true });
}));

app.post('/api/practice', requireUser, rateLimit({ windowMs: 60_000, limit: 5, standardHeaders: true, legacyHeaders: false }), asyncRoute(async (req, res) => {
  const topic = String(req.body.topic || 'Beginner math').trim().slice(0, 100);
  const raw = await askAI(`${tutorInstructions}\nCreate exactly 4 beginner practice questions about the requested topic. Return only valid JSON matching {"questions":[{"prompt":"...","choices":["...","...","...","..."],"correctIndex":0,"explanation":"..."}]}. Make one correct answer per question, use integer correctIndex 0-3, and make explanations brief.`, `Topic: ${topic}`, 1200);
  let parsed;
  try { parsed = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/gi, '').trim()); } catch { const error = new Error('Practice questions could not be formatted. Please try again.'); error.status = 502; throw error; }
  if (!Array.isArray(parsed.questions) || parsed.questions.length !== 4 || parsed.questions.some(q => !q.prompt || !Array.isArray(q.choices) || q.choices.length !== 4 || !Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex > 3 || !q.explanation)) { const error = new Error('The practice set was incomplete. Please try again.'); error.status = 502; throw error; }
  const id = crypto.randomUUID();
  const saved = await pool.query('INSERT INTO practice_sets(id,user_id,topic,questions) VALUES($1,$2,$3,$4) RETURNING id,topic,questions,created_at', [id, req.user.id, topic, JSON.stringify(parsed.questions)]);
  res.status(201).json(saved.rows[0]);
}));
app.get('/api/practice', requireUser, asyncRoute(async (req, res) => {
  const items = await pool.query('SELECT id,topic,questions,created_at FROM practice_sets WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10', [req.user.id]);
  res.json({ practiceSets: items.rows });
}));

app.get('/api/runtimes', requireUser, asyncRoute(async (_req, res) => {
  if (!pistonUrl) return res.status(503).json({ error: 'Code runner is not configured. Set PISTON_API_URL in Render.' });
  const response = await fetch(`${pistonUrl}/api/v2/runtimes`, { headers: process.env.PISTON_API_KEY ? { authorization: `Bearer ${process.env.PISTON_API_KEY}` } : {}, signal: AbortSignal.timeout(10_000) });
  const runtimes = await response.json();
  if (!response.ok) return res.status(502).json({ error: 'Could not load code runner languages.' });
  res.json({ runtimes: runtimes.filter(r => ['python','javascript'].includes(r.language)) });
}));
app.post('/api/run', requireUser, rateLimit({ windowMs: 60_000, limit: 8, standardHeaders: true, legacyHeaders: false }), asyncRoute(async (req, res) => {
  if (!pistonUrl) return res.status(503).json({ error: 'Code execution is not configured yet. Set PISTON_API_URL to a private Piston runner service.' });
  const code = typeof req.body.code === 'string' ? req.body.code : '';
  const language = req.body.language === 'python' ? 'python' : req.body.language === 'javascript' ? 'javascript' : '';
  const stdin = typeof req.body.stdin === 'string' ? req.body.stdin.slice(0, 2_000) : '';
  if (!language) return res.status(400).json({ error: 'Choose Python or JavaScript.' });
  if (!code.trim() || code.length > 8_000) return res.status(400).json({ error: 'Code must be between 1 and 8,000 characters.' });
  const runtimeResponse = await fetch(`${pistonUrl}/api/v2/runtimes`, { headers: process.env.PISTON_API_KEY ? { authorization: `Bearer ${process.env.PISTON_API_KEY}` } : {}, signal: AbortSignal.timeout(10_000) });
  const runtimes = await runtimeResponse.json();
  const runtime = runtimes.find(r => r.language === language);
  if (!runtime) return res.status(503).json({ error: `The code runner does not have ${language} installed.` });
  const result = await fetch(`${pistonUrl}/api/v2/execute`, { method: 'POST', headers: { 'content-type': 'application/json', ...(process.env.PISTON_API_KEY ? { authorization: `Bearer ${process.env.PISTON_API_KEY}` } : {}) }, body: JSON.stringify({ language, version: runtime.version, files: [{ name: language === 'python' ? 'main.py' : 'main.js', content: code }], stdin, compile_timeout: 10_000, run_timeout: 3_000, compile_memory_limit: 128_000_000, run_memory_limit: 128_000_000 }), signal: AbortSignal.timeout(20_000) });
  const output = await result.json().catch(() => ({}));
  if (!result.ok) return res.status(502).json({ error: output.message || 'The code runner could not run this program.' });
  res.json({ language, compile: output.compile ? { stdout: output.compile.stdout?.slice(0, 4000), stderr: output.compile.stderr?.slice(0, 4000), code: output.compile.code } : null, run: { stdout: output.run?.stdout?.slice(0, 4000), stderr: output.run?.stderr?.slice(0, 4000), code: output.run?.code, signal: output.run?.signal } });
}));

app.get('/', (_req, res) => res.sendFile(fileURLToPath(new URL('./index.html', import.meta.url))));
app.use((err, _req, res, _next) => { console.error(err); res.status(err.status || 500).json({ error: err.status ? err.message : 'Something went wrong. Please try again.' }); });

async function start() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required. Add a Render Postgres database or set it locally.');
  await pool.query(schema);
  app.listen(port, '0.0.0.0', () => console.log(`Clarity listening on port ${port}`));
}
start().catch(error => { console.error('Startup failed:', error); process.exit(1); });
