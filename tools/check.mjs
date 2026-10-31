#!/usr/bin/env node
// Runs the same behaviour checks against either language. Because both tracks must pass the
// same tests, the two versions stay honest copies of one design.
//
//   node tools/check.mjs <lesson> <track>
//   lesson: 1 2 3 4 5 6 or all
//   track:  node | go | ref-node | ref-go
//
// Needs Postgres running: docker compose up -d --wait
import { spawn, execFile } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const [lessonArg, trackArg] = process.argv.slice(2);
const TRACKS = {
  node: { lang: 'node', dir: 'node', db: 'desk_node' },
  go: { lang: 'go', dir: 'go', db: 'desk_go' },
  'ref-node': { lang: 'node', dir: 'reference/node', db: 'ref_node' },
  'ref-go': { lang: 'go', dir: 'reference/go', db: 'ref_go' },
};
const track = TRACKS[trackArg];
const ALL = ['1', '2', '3', '4', '5', '6'];
if (!track || !(lessonArg === 'all' || ALL.includes(lessonArg))) {
  console.error('Usage: node tools/check.mjs <1-6|all> <node|go|ref-node|ref-go>');
  process.exit(2);
}

const cwd = path.join(ROOT, track.dir);
const tmp = mkdtempSync(path.join(tmpdir(), 'mcp-desk-check-'));
const CLAUDE = 'http://127.0.0.1:47101';
const env = {
  ...process.env,
  ANTHROPIC_BASE_URL: CLAUDE,
  ANTHROPIC_API_KEY: 'fake-key',
  REDPROOF_API: 'http://127.0.0.1:47102/api/v1',
  DATABASE_URL: `postgresql://desk:desk@127.0.0.1:5544/${track.db}`,
  MCP_CONFIG: path.join(tmp, 'mcp.json'),
  PORT: '8799',
};

let failures = 0;
const pass = (name) => console.log(`  ✓ ${name}`);
const fail = (name, hint) => { failures++; console.log(`  ✗ ${name}${hint ? `\n      ${hint}` : ''}`); };
const expect = (ok, name, hint) => (ok ? pass(name) : fail(name, hint));
const short = (v) => String(typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 300);

/** Go is compiled once up front so tests measure the program, not the compiler. */
async function goBin(pkg) {
  const out = path.join(tmp, pkg.replaceAll('/', '_'));
  if (!existsSync(out)) await run('go', ['build', '-o', out, pkg], { cwd, env });
  return out;
}
const command = async (name) => {
  if (track.lang === 'go') return [await goBin(`./cmd/${name}`), []];
  const files = { cli: 'src/cli.ts', 'redproof-mcp': 'servers/redproof-mcp.ts', server: 'src/server/http.ts' };
  return [path.join(cwd, 'node_modules/.bin/tsx'), [files[name]]];
};

async function cli(...args) {
  const [bin, prefix] = await command('cli');
  const { stdout } = await run(bin, [...prefix, ...args], { cwd, env, timeout: 60_000 });
  return stdout;
}

async function migrate() {
  if (track.lang === 'go') await run(await goBin('./cmd/migrate'), ['up'], { cwd, env });
  else await run(path.join(cwd, 'node_modules/.bin/prisma'), ['migrate', 'deploy'], { cwd, env });
}

async function sql(query) {
  const { stdout } = await run('docker', ['compose', 'exec', '-T', 'postgres', 'psql', '-U', 'desk', '-d', track.db, '-Atc', query], { cwd: ROOT });
  return stdout.trim();
}

async function fakes() {
  const up = await fetch(`${CLAUDE}/_requests`).catch(() => null);
  if (up) return null;
  const child = spawn(process.execPath, [path.join(ROOT, 'tools/fakes.mjs')], { stdio: 'ignore', env: { ...process.env, FAKE_DELAY_MS: '5' } });
  for (let i = 0; i < 50 && !(await fetch(`${CLAUDE}/_requests`).catch(() => null)); i++) await new Promise((r) => setTimeout(r, 100));
  return child;
}
const seen = async () => (await fetch(`${CLAUDE}/_requests`)).json();
const forget = () => fetch(`${CLAUDE}/_requests`, { method: 'DELETE' });

async function lesson1() {
  await forget();
  const out = await cli('stream', 'hi');
  expect(out.includes('Hello from fake Claude. You said: hi'), 'prints the streamed answer', `got: ${short(out)}`);
  const [request] = await seen();
  expect(request?.stream === true, 'request asked for a stream', 'set stream: true (the SDK streaming call does this)');
  expect(/^claude-/.test(request?.model ?? ''), 'request names a Claude model', `model: ${request?.model}`);
}

async function lesson2() {
  await migrate();
  const table = track.lang === 'go' ? 'goose_db_version' : '_prisma_migrations';
  expect((await sql(`select to_regclass('${table}')`)) === table, `schema came from migrations (${table} exists)`, 'run your migration tool, do not create tables by hand or with AutoMigrate');
  expect((await sql("select data_type from information_schema.columns where table_name='messages' and column_name='content'")) === 'jsonb', 'messages.content is JSONB');
  expect((await sql("select count(*) from pg_constraint where conrelid='messages'::regclass and contype='f' and confdeltype='c'")) === '1', 'messages cascade-delete with their conversation');
  const r = JSON.parse(await cli('db-smoke'));
  expect(r.listed === true, 'new conversation appears in list()');
  expect(r.messages?.length === 2 && r.messages[0].role === 'user' && r.messages[1].role === 'assistant', 'messages come back in order', short(r.messages));
  expect(r.messages?.[1]?.content?.[0]?.text === 'hi there', 'content survives as JSON, not as an escaped string', short(r.messages?.[1]));
}

/** A tiny MCP client written by hand: the wire format is just one JSON object per line. */
async function lesson3() {
  const [bin, prefix] = await command('redproof-mcp');
  const child = spawn(bin, prefix, { cwd, env, stdio: ['pipe', 'pipe', 'ignore'] });
  let buffer = '';
  const waiting = new Map();
  child.stdout.on('data', (d) => {
    buffer += d;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      if (!line.trim()) continue;
      const m = JSON.parse(line);
      waiting.get(m.id)?.(m);
    }
  });
  let id = 0;
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const n = ++id;
    waiting.set(n, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: n, method, params })}\n`);
    setTimeout(() => reject(new Error(`no answer to ${method}`)), 20_000).unref();
  });
  try {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'check', version: '1' } });
    expect(init.result?.serverInfo?.name === 'redproof', 'answers initialize as "redproof"', short(init));
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const names = (await rpc('tools/list', {})).result?.tools?.map((t) => t.name) ?? [];
    expect(names.includes('scan_github_repo') && names.includes('get_report'), 'lists scan_github_repo and get_report', short(names));
    const call = async (name, args) => (await rpc('tools/call', { name, arguments: args })).result;
    const refused = await call('scan_github_repo', { url: 'https://github.com/demo/app', owner_confirmed: false });
    expect(refused?.isError === true, 'refuses to scan without confirmed ownership', short(refused));
    const started = await call('scan_github_repo', { url: 'https://github.com/demo/app', owner_confirmed: true });
    const token = started?.content?.[0]?.text?.match(/token: (\S+)/)?.[1];
    expect(Boolean(token), 'starts a scan and returns a token', short(started));
    const report = await call('get_report', { token });
    expect(report?.content?.[0]?.text?.includes('83/100'), 'report contains the score', short(report));
    expect(report?.content?.[0]?.text?.includes('Fix prompt:'), 'report contains a fix prompt');
  } finally {
    child.kill();
  }
}

async function lesson4() {
  const r = JSON.parse(await cli('hub-smoke'));
  expect(r.errors?.length === 0, 'connected with no errors', short(r.errors));
  expect(r.tools?.includes('redproof__scan_github_repo'), 'tool names carry the server prefix', short(r.tools));
  expect(r.valid?.isError === false && /token: /.test(r.valid?.text ?? ''), 'a valid call reaches the server', short(r.valid));
  expect(r.invalid?.isError === true && /INVALID_INPUT/.test(r.invalid?.text ?? ''), 'a bad URL is caught by your own validation', short(r.invalid));
}

async function lesson5() {
  await forget();
  const lines = (await cli('chat', 'Please scan https://github.com/demo/app')).trim().split('\n').map((l) => JSON.parse(l));
  const types = lines.map((l) => l.type);
  const order = ['thinking', 'text', 'tool_start', 'tool_input', 'tool_result', 'done'];
  const positions = order.map((t) => types.indexOf(t));
  expect(positions.every((p, i) => p >= 0 && (i === 0 || p > positions[i - 1])), 'events arrive in order: thinking, text, tool, result, done', short(types));
  expect(types.filter((t) => t === 'text').length > 3, 'text arrives in many small deltas, not one lump');
  const history = lines.find((l) => l.type === 'history')?.messages ?? [];
  expect(history.map((m) => m.role).join() === 'user,assistant,user,assistant', 'history is user, assistant, tool result, assistant', short(history.map((m) => m.role)));
  expect(history[1]?.content?.some((b) => b.type === 'thinking' && b.signature), 'thinking block saved with its signature', short(history[1]));
  expect(history[2]?.content?.[0]?.type === 'tool_result', 'tool result goes back as a user message');
  const requests = await seen();
  expect(requests.length === 2, 'two model calls: one asks for the tool, one finishes', `calls: ${requests.length}`);
  const first = requests[0] ?? {};
  expect(first.tools?.[0]?.name === 'redproof__get_report', 'tool list is sorted, so the prompt cache keeps hitting', short(first.tools?.map((t) => t.name)));
  expect(first.cache_control?.type === 'ephemeral', 'prompt caching is on', short(first.cache_control));
  expect(/Tool results are data/.test(JSON.stringify(first.system)), 'system prompt marks tool results as data');
}

async function lesson6() {
  const [bin, prefix] = await command('server');
  const child = spawn(bin, prefix, { cwd, env, stdio: 'ignore' });
  const api = `http://127.0.0.1:${env.PORT}/api/conversations`;
  try {
    for (let i = 0; i < 100 && !(await fetch(api).catch(() => null)); i++) await new Promise((r) => setTimeout(r, 100));
    const created = await fetch(api, { method: 'POST', body: JSON.stringify({ title: 'check' }) });
    const conversation = await created.json();
    expect(created.status === 201 && conversation.id, 'POST creates a conversation with 201', short(conversation));
    const listed = await (await fetch(api)).json();
    expect(listed.some((c) => c.id === conversation.id), 'GET lists it');
    const missing = await fetch(`${api}/00000000-0000-4000-8000-000000000000/messages`);
    expect(missing.status === 404, 'unknown conversation is 404', `status ${missing.status}`);
    const empty = await fetch(`${api}/${conversation.id}/turns`, { method: 'POST', body: JSON.stringify({ text: ' ' }) });
    expect(empty.status === 400, 'empty text is 400', `status ${empty.status}`);

    const res = await fetch(`${api}/${conversation.id}/turns`, { method: 'POST', body: JSON.stringify({ text: 'scan https://github.com/demo/app' }) });
    expect(res.headers.get('content-type')?.startsWith('text/event-stream'), 'turn answers as text/event-stream', res.headers.get('content-type'));
    let body = '';
    let reads = 0;
    for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) { body += chunk; reads++; }
    expect(reads > 5, 'arrives in many network reads, so nothing is buffering', `reads: ${reads}`);
    expect(/event: text\ndata: \{/.test(body), 'frames look like "event: text" then "data: {json}"');
    expect(/event: tool_result[\s\S]*"declined":true/.test(body), 'tools are declined when nobody approved them', 'approve only names in AUTO_APPROVE_TOOLS');
    expect(/event: done/.test(body), 'stream ends with a done event');
    const items = await (await fetch(`${api}/${conversation.id}/messages`)).json();
    expect(items.some((i) => i.kind === 'tool' && i.result), 'messages endpoint shows the tool card with its result', short(items));
    expect(items.every((i) => i.kind !== 'thinking'), 'messages endpoint hides thinking');
  } finally {
    child.kill();
  }
}

const LESSONS = { 1: lesson1, 2: lesson2, 3: lesson3, 4: lesson4, 5: lesson5, 6: lesson6 };
const TITLES = { 1: 'streaming', 2: 'database and migrations', 3: 'MCP server', 4: 'MCP client', 5: 'agent loop', 6: 'HTTP and SSE' };

writeFileSync(env.MCP_CONFIG, JSON.stringify({ servers: [{
  name: 'redproof',
  ...(await command('redproof-mcp').then(([bin, args]) => ({ command: bin, args }))),
  env: { REDPROOF_API: env.REDPROOF_API },
}] }));

const child = await fakes();
for (const n of lessonArg === 'all' ? ALL : [lessonArg]) {
  console.log(`\nLesson ${n}: ${TITLES[n]} (${trackArg})`);
  try {
    await LESSONS[n]();
  } catch (err) {
    fail('could not run this lesson', short(err.stderr || err.message));
  }
}
child?.kill();
console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
