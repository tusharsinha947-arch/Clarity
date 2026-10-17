import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const maxBodyBytes = 16_000;

const tutorInstructions = `You are Clarity, a patient tutor for beginner mathematics and programming. Explain in plain language, use small numbered steps, and show how to check the answer. For math, make calculations explicit. For code, explain the key idea and show a short example. Ask one concise follow-up question if the prompt is missing essential details. Never claim code was executed unless it actually was. Do not provide a bare answer when a teaching explanation is possible.`;

function send(res, status, data, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBodyBytes) throw Object.assign(new Error('Request is too large.'), { status: 413 });
  }
  try { return JSON.parse(body); }
  catch { throw Object.assign(new Error('Send a valid JSON request.'), { status: 400 }); }
}

async function solve(question, subject) {
  if (!apiKey) throw Object.assign(new Error('AI is not configured yet. Add OPENAI_API_KEY to the server environment.'), { status: 503 });
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      instructions: `${tutorInstructions}\nThe learner selected this subject: ${subject}. If the question belongs elsewhere, gently note that and still help when possible.`,
      input: question,
      max_output_tokens: 900,
      store: false
    }),
    signal: AbortSignal.timeout(45_000)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || 'The AI service could not answer right now.');
    error.status = response.status === 429 ? 429 : 502;
    throw error;
  }
  const answer = (payload.output || []).flatMap(item => item.content || [])
    .filter(item => item.type === 'output_text').map(item => item.text).join('\n').trim();
  if (!answer) throw Object.assign(new Error('The tutor returned an empty answer. Please try again.'), { status: 502 });
  return { answer, model: payload.model || model };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true, aiConfigured: Boolean(apiKey) });
  if (req.method === 'POST' && url.pathname === '/api/solve') {
    try {
      const input = await readJson(req);
      const question = typeof input.question === 'string' ? input.question.trim() : '';
      const subject = input.subject === 'Coding' ? 'Coding' : 'Math';
      if (question.length < 3) return send(res, 400, { error: 'Please enter a question with at least 3 characters.' });
      if (question.length > 4_000) return send(res, 400, { error: 'Please keep your question under 4,000 characters.' });
      const result = await solve(question, subject);
      return send(res, 200, { id: randomUUID(), subject, question, ...result, createdAt: new Date().toISOString() });
    } catch (error) {
      const status = error.status || (error.name === 'TimeoutError' ? 504 : 502);
      return send(res, status, { error: error.message || 'Something went wrong. Please try again.' });
    }
  }
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    try {
      const page = await readFile(path.join(here, 'index.html'));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
      return res.end(page);
    } catch { return send(res, 500, { error: 'Could not load the Clarity page.' }); }
  }
  return send(res, 404, { error: 'Not found.' });
});

server.listen(port, () => console.log(`Clarity server listening at http://localhost:${port}`));
