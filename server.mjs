import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const app = express();
const port = Number(process.env.PORT || 3000);
const openAiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const pistonUrl = process.env.PISTON_API_URL?.replace(/\/$/, '');
const pistonHeaders = process.env.PISTON_API_KEY ? { authorization: `Bearer ${process.env.PISTON_API_KEY}` } : {};
const demoUser = { id: '00000000-0000-4000-8000-000000000001', name: 'Demo Learner', email: 'demo@clarity.local' };
const problems = [
  { id: crypto.randomUUID(), user_id: demoUser.id, subject: 'Math', question: 'How do I find the area of a triangle?', answer: 'Use the formula area = (base × height) ÷ 2. If the base is 8 and the height is 5, then (8 × 5) ÷ 2 = 20 square units.', created_at: new Date(Date.now() - 86_400_000).toISOString() },
  { id: crypto.randomUUID(), user_id: demoUser.id, subject: 'Coding', question: 'What does a Python for loop do?', answer: 'A for loop repeats a block of code for each item in a sequence. Example: `for number in [1, 2, 3]: print(number)` prints each number once.', created_at: new Date(Date.now() - 2 * 86_400_000).toISOString() }
];
const practiceSets = [];

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(express.json({ limit: '16kb' }));
app.use((req, _res, next) => { req.body ||= {}; next(); });
app.use(express.static(path.dirname(fileURLToPath(import.meta.url)), { index: false, maxAge: '1h' }));
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const requireUser = (req, _res, next) => { req.user = demoUser; next(); };

const tutorInstructions = `You are Clarity, a patient tutor for beginner mathematics and programming. Use plain language, small numbered steps, and show how to check the result. For math, make calculations explicit. For code, explain the key idea and show a short example. Ask one concise follow-up if essential details are missing. Never claim code was executed unless it actually was.`;
async function askAI(instructions, input, maxOutput = 900) {
  if (!openAiKey) return null;
  const response = await fetch('https://api.openai.com/v1/responses', { method: 'POST', headers: { authorization: `Bearer ${openAiKey}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, instructions, input, max_output_tokens: maxOutput, store: false }), signal: AbortSignal.timeout(45_000) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(payload.error?.message || 'The AI service could not answer right now.'); error.status = response.status === 429 ? 429 : 502; throw error; }
  const text = (payload.output || []).flatMap(item => item.content || []).filter(item => item.type === 'output_text').map(item => item.text).join('\n').trim();
  if (!text) { const error = new Error('The tutor returned an empty answer. Please try again.'); error.status = 502; throw error; }
  return text;
}
function demoAnswer(question, subject) {
  return `Let's work through your ${subject.toLowerCase()} question together.\n\n1. First, identify what the problem is asking you to find.\n2. Break it into smaller parts and write down the information you already have.\n3. Apply the relevant rule or idea one step at a time.\n4. Check that your result answers the original question.\n\nYour question was: “${question.slice(0, 500)}”\n\nThis is a sample preview explanation. Add OPENAI_API_KEY in Render to get a tailored AI answer.`;
}
const practiceFallback = topic => ({ questions: [
  { prompt: `Which is the best first step when solving a problem about ${topic}?`, choices: ['Identify what is being asked', 'Guess the answer', 'Skip the instructions', 'Change the subject'], correctIndex: 0, explanation: 'Start by understanding what you need to find.' },
  { prompt: 'What should you do after getting an answer?', choices: ['Check it against the question', 'Erase your work', 'Ignore units', 'Stop reading'], correctIndex: 0, explanation: 'Checking helps catch mistakes and confirms the answer makes sense.' },
  { prompt: 'Why break a problem into smaller steps?', choices: ['It makes the reasoning easier to follow', 'It changes the answer', 'It avoids learning', 'It makes every problem identical'], correctIndex: 0, explanation: 'Smaller steps make a hard idea easier to understand.' },
  { prompt: 'If your first attempt seems wrong, what is a useful next move?', choices: ['Review each step', 'Give up immediately', 'Hide the work', 'Repeat the same guess'], correctIndex: 0, explanation: 'Reviewing your steps helps you find where the reasoning changed.' }
] });

app.get('/api/health', (_req, res) => res.json({ ok: true, demoMode: true, aiConfigured: Boolean(openAiKey), codeRunnerConfigured: Boolean(pistonUrl) }));
app.get('/api/auth/me', (_req, res) => res.json({ user: demoUser, demoMode: true }));
app.post('/api/auth/register', (_req, res) => res.status(200).json({ user: demoUser, demoMode: true }));
app.post('/api/auth/login', (_req, res) => res.json({ user: demoUser, demoMode: true }));
app.post('/api/auth/logout', (_req, res) => res.json({ ok: true }));

app.get('/api/dashboard', requireUser, (_req, res) => {
  const thisWeek = problems.filter(p => Date.now() - new Date(p.created_at).getTime() < 7 * 86_400_000).length;
  res.json({ user: demoUser, history: [...problems].sort((a,b) => new Date(b.created_at)-new Date(a.created_at)).slice(0,8), progress: { thisWeek, minutes: thisWeek * 12, total: problems.length, practiceSets: practiceSets.length, weeklyGoal: 6, percent: Math.min(100, Math.round(thisWeek / 6 * 100)) } });
});
app.post('/api/solve', requireUser, rateLimit({ windowMs: 60_000, limit: 12, standardHeaders: true, legacyHeaders: false }), asyncRoute(async (req,res) => {
  const question = typeof req.body.question === 'string' ? req.body.question.trim() : '';
  const subject = req.body.subject === 'Coding' ? 'Coding' : 'Math';
  if (question.length < 3 || question.length > 4_000) return res.status(400).json({ error: 'Questions must be between 3 and 4,000 characters.' });
  const answer = await askAI(`${tutorInstructions}\nThe learner selected ${subject}. If another subject fits better, note that briefly and help anyway.`, question) || demoAnswer(question, subject);
  const saved = { id: crypto.randomUUID(), user_id: demoUser.id, subject, question, answer, created_at: new Date().toISOString() };
  problems.unshift(saved); res.status(201).json(saved);
}));
app.delete('/api/problems/:id', requireUser, (req,res) => { const index=problems.findIndex(p=>p.id===req.params.id); if(index<0)return res.status(404).json({error:'Problem not found.'}); problems.splice(index,1); res.json({ok:true}); });

app.post('/api/practice', requireUser, rateLimit({ windowMs: 60_000, limit: 5, standardHeaders: true, legacyHeaders: false }), asyncRoute(async (req,res) => {
  const topic = String(req.body.topic || 'Beginner math').trim().slice(0,100);
  let parsed;
  const raw = await askAI(`${tutorInstructions}\nCreate exactly 4 beginner practice questions. Return only JSON matching {"questions":[{"prompt":"...","choices":["...","...","...","..."],"correctIndex":0,"explanation":"..."}]}.`, `Topic: ${topic}`, 1200);
  if (!raw) parsed = practiceFallback(topic);
  else { try { parsed=JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/gi,'').trim()); } catch { return res.status(502).json({error:'Practice questions could not be formatted. Please try again.'}); } }
  if (!Array.isArray(parsed.questions) || parsed.questions.length!==4 || parsed.questions.some(q=>!q.prompt||!Array.isArray(q.choices)||q.choices.length!==4||!Number.isInteger(q.correctIndex)||q.correctIndex<0||q.correctIndex>3||!q.explanation)) return res.status(502).json({error:'The practice set was incomplete. Please try again.'});
  const set={id:crypto.randomUUID(),topic,questions:parsed.questions,created_at:new Date().toISOString()}; practiceSets.unshift(set); res.status(201).json(set);
}));
app.get('/api/practice', requireUser, (_req,res) => res.json({practiceSets}));

app.get('/api/runtimes', requireUser, asyncRoute(async (_req,res) => {
  if(!pistonUrl)return res.status(503).json({error:'Code runner is not configured. Set PISTON_API_URL in Render.'});
  const r=await fetch(`${pistonUrl}/api/v2/runtimes`,{headers:pistonHeaders,signal:AbortSignal.timeout(10_000)});const runtimes=await r.json();if(!r.ok)return res.status(502).json({error:'Could not load code runner languages.'});res.json({runtimes:runtimes.filter(x=>['python','javascript'].includes(x.language))});
}));
app.post('/api/run', requireUser, rateLimit({windowMs:60_000,limit:8,standardHeaders:true,legacyHeaders:false}), asyncRoute(async(req,res)=>{
  if(!pistonUrl)return res.status(503).json({error:'Code execution is not configured yet. Set PISTON_API_URL to a private Piston runner service.'});
  const code=typeof req.body.code==='string'?req.body.code:'';const language=['python','javascript'].includes(req.body.language)?req.body.language:'';const stdin=typeof req.body.stdin==='string'?req.body.stdin.slice(0,2000):'';
  if(!language)return res.status(400).json({error:'Choose Python or JavaScript.'});if(!code.trim()||code.length>8000)return res.status(400).json({error:'Code must be between 1 and 8,000 characters.'});
  const rr=await fetch(`${pistonUrl}/api/v2/runtimes`,{headers:pistonHeaders,signal:AbortSignal.timeout(10_000)});const runtimes=await rr.json();const runtime=runtimes.find(x=>x.language===language);if(!runtime)return res.status(503).json({error:`The code runner does not have ${language} installed.`});
  const r=await fetch(`${pistonUrl}/api/v2/execute`,{method:'POST',headers:{'content-type':'application/json',...pistonHeaders},body:JSON.stringify({language,version:runtime.version,files:[{name:language==='python'?'main.py':'main.js',content:code}],stdin,compile_timeout:10000,run_timeout:3000,compile_memory_limit:128000000,run_memory_limit:128000000}),signal:AbortSignal.timeout(20000)});const d=await r.json().catch(()=>({}));if(!r.ok)return res.status(502).json({error:d.message||'The code runner could not run this program.'});res.json({language,compile:d.compile?{stdout:d.compile.stdout?.slice(0,4000),stderr:d.compile.stderr?.slice(0,4000),code:d.compile.code}:null,run:{stdout:d.run?.stdout?.slice(0,4000),stderr:d.run?.stderr?.slice(0,4000),code:d.run?.code,signal:d.run?.signal}});
}));

app.get('/', (_req,res)=>res.sendFile(fileURLToPath(new URL('./index.html',import.meta.url))));
app.use((err,_req,res,_next)=>{console.error(err);res.status(err.status||500).json({error:err.status?err.message:'Something went wrong. Please try again.'});});
app.listen(port,'0.0.0.0',()=>console.log(`Clarity preview listening on port ${port} (no database)`));
