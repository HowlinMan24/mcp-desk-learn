#!/usr/bin/env node
// Stand-ins for the two outside services, so every lesson runs offline and costs nothing.
//
//   http://127.0.0.1:47101  fake Anthropic Messages API (streams real-format SSE events)
//   http://127.0.0.1:47102  fake Redproof API
//
// Point the code at them with:
//   ANTHROPIC_BASE_URL=http://127.0.0.1:47101 ANTHROPIC_API_KEY=fake
//   REDPROOF_API=http://127.0.0.1:47102/api/v1
//
// GET http://127.0.0.1:47101/_requests shows every request body it received, which is the
// quickest way to see exactly what your code sent to "Claude".
import { createServer } from 'node:http';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DELAY = Number(process.env.FAKE_DELAY_MS ?? 15);
const requests = [];

const readBody = async (req) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
};

const json = (res, status, data) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
};

/** Splits text the way a model does: small pieces, so streaming is visible. */
const pieces = (text, size = 6) => text.match(new RegExp(`[\\s\\S]{1,${size}}`, 'g')) ?? [];

const textOf = (message) =>
  typeof message.content === 'string'
    ? message.content
    : message.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ');

/** Decides what "Claude" says from the last message. Deterministic on purpose. */
function plan(body) {
  const last = body.messages.at(-1);
  const results = Array.isArray(last.content) ? last.content.filter((b) => b.type === 'tool_result') : [];
  if (results.length) {
    const first = results[0];
    const content = typeof first.content === 'string' ? first.content : first.content.map((c) => c.text).join('\n');
    return { text: `The tool ${first.is_error ? 'failed' : 'answered'}: ${content.split('\n')[0]}` };
  }
  const said = textOf(last);
  const tool = (body.tools ?? []).find((t) => t.name.endsWith('scan_github_repo'));
  if (tool && /scan|redproof|check/i.test(said)) {
    const url = said.match(/https:\/\/github\.com\/\S+/)?.[0] ?? 'https://github.com/demo/app';
    return {
      thinking: 'The user wants a security check, so I should start a scan.',
      text: 'Starting a Redproof scan.',
      tool: { name: tool.name, input: { url, owner_confirmed: true } },
    };
  }
  return { thinking: 'A plain question, no tool needed.', text: `Hello from fake Claude. You said: ${said}` };
}

async function streamMessage(res, p, model) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
  const send = async (type, data) => {
    res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    await sleep(DELAY);
  };
  await send('message_start', {
    message: {
      id: `msg_fake_${Date.now()}`, type: 'message', role: 'assistant', model, content: [],
      stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 120, output_tokens: 1, cache_read_input_tokens: 80, cache_creation_input_tokens: 0 },
    },
  });
  let index = 0;
  if (p.thinking) {
    await send('content_block_start', { index, content_block: { type: 'thinking', thinking: '', signature: '' } });
    for (const delta of pieces(p.thinking, 12)) await send('content_block_delta', { index, delta: { type: 'thinking_delta', thinking: delta } });
    await send('content_block_delta', { index, delta: { type: 'signature_delta', signature: 'fake-signature' } });
    await send('content_block_stop', { index });
    index++;
  }
  await send('content_block_start', { index, content_block: { type: 'text', text: '' } });
  for (const delta of pieces(p.text)) await send('content_block_delta', { index, delta: { type: 'text_delta', text: delta } });
  await send('content_block_stop', { index });
  index++;
  if (p.tool) {
    await send('content_block_start', { index, content_block: { type: 'tool_use', id: `toolu_fake_${Date.now()}`, name: p.tool.name, input: {} } });
    for (const delta of pieces(JSON.stringify(p.tool.input), 10)) await send('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: delta } });
    await send('content_block_stop', { index });
  }
  await send('message_delta', { delta: { stop_reason: p.tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 42 } });
  await send('message_stop', {});
  res.end();
}

createServer(async (req, res) => {
  try {
    if (req.method === 'DELETE' && req.url === '/_requests') { requests.length = 0; return json(res, 200, {}); }
    if (req.url === '/_requests') return json(res, 200, requests);
    if (req.method === 'POST' && req.url.startsWith('/v1/messages')) {
      const body = await readBody(req);
      requests.push(body);
      if (!req.headers['x-api-key'] && !req.headers.authorization) return json(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'No API key' } });
      return await streamMessage(res, plan(body), body.model);
    }
    json(res, 404, { type: 'error', error: { type: 'not_found_error', message: req.url } });
  } catch (err) {
    json(res, 500, { type: 'error', error: { type: 'api_error', message: String(err) } });
  }
}).listen(47101, '127.0.0.1');

const TOKEN = 'fake_token_0123456789_abcdefghijklmnopqrstuv'.padEnd(43, 'x').slice(0, 43);
const REPORT = {
  token: TOKEN, status: 'scored', error: null, source: 'github.com/demo/app', score: 83,
  counts: { critical: 0, high: 1, medium: 0, low: 5 }, paid: false,
  findings: [{
    severity: 'high', title: 'Supabase key in client code', plain: 'A secret key ships to every browser.',
    fixPrompt: 'Move the key to a server-side function and rotate it.', locations: [{ file: 'src/lib/db.ts', line: 12 }],
  }],
  locked: [{ severity: 'low' }],
};

createServer(async (req, res) => {
  const body = await readBody(req).catch(() => ({}));
  if (req.method === 'POST' && req.url === '/api/v1/scans/github') {
    if (!body.confirmOwnership) return json(res, 400, { message: 'Ownership must be confirmed' });
    return json(res, 201, { token: TOKEN });
  }
  if (req.method === 'GET' && req.url === `/api/v1/scans/${TOKEN}`) return json(res, 200, REPORT);
  json(res, 404, { message: 'Not found' });
}).listen(47102, '127.0.0.1');

console.log('fake Claude   http://127.0.0.1:47101');
console.log('fake Redproof http://127.0.0.1:47102');
