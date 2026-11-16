#!/usr/bin/env node
// Seed fixture for the app-wide audit suite (card #901024). Test data only.
//
//   node seed.mjs files <vault-dir> <agents-dir>     before the server boots
//   node seed.mjs db    <db-path>   <base-url>       after it is healthy
//
// "files" writes a small knowledge base and one demo bot file. "db" creates two
// users straight in the scratch database (there is no sign-up API), then builds
// everything else through the same HTTP API the app uses, so the fixture breaks
// loudly when an API changes. The few things with no safe API (review states,
// notifications) are written with SQL and say so below.
// Writes a manifest of what it made to $E2E_SEED_FILE for the specs.
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const WS = 'e2e-ws'
export const BOT = 'e2e-helper'
const [mode, a, b] = process.argv.slice(2)

if (mode === 'files') seedFiles(a, b)
else if (mode === 'db') await seedDb(a, b)
else { console.error('usage: seed.mjs files <vault> <agents> | db <db-path> <base-url>'); process.exit(2) }

function seedFiles(vault, agents) {
  const ws = path.join(vault, 'workspaces', WS)
  const files = {
    'README.md': '# E2E workspace\n\nSeeded knowledge base for the audit suite. See [[decisions/2026-01-01-pick-a-colour]].\n',
    'decisions/2026-01-01-pick-a-colour.md': '---\ntitle: Pick a colour\ndate: 2026-01-01\n---\n\n# Pick a colour\n\nWe use one accent colour. Related: [[people/ada-example]].\n',
    'people/ada-example.md': '# Ada Example\n\nA made-up person. Works on the zebracorn project.\n',
    'projects/zebracorn.md': '# Zebracorn\n\nA made-up project used to test search. Owner: [[people/ada-example]].\n',
  }
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(ws, rel)), { recursive: true })
    fs.writeFileSync(path.join(ws, rel), body)
  }
  fs.mkdirSync(path.join(agents, BOT), { recursive: true })
  fs.writeFileSync(path.join(agents, BOT, 'agent.yaml'), [
    'name: E2E Helper',
    'description: Seeded demo bot for the audit suite. Replies without an AI account.',
    'provider: demo',
    'colour: blue',
    'system_prompt: You are a test bot.',
    'example_prompts:',
    '  - What can you do?',
    '',
  ].join('\n'))
  console.log(`[seed] files: ${Object.keys(files).length} pages in ${ws}, bot "${BOT}" in ${agents}`)
}

async function seedDb(dbPath, base) {
  const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../app/server')
  const require = createRequire(path.join(appDir, 'package.json'))
  const Database = require('better-sqlite3')
  const bcrypt = require('bcrypt')
  const db = new Database(dbPath)
  const admin = process.env.E2E_ADMIN_USER || 'e2e-admin'
  const member = process.env.E2E_MEMBER_USER || 'e2e-member'
  const pass = process.env.E2E_PASS
  if (!pass || pass.length < 8) { console.error('seed: set E2E_PASS (8+ chars)'); process.exit(2) }

  // Users: SQL (no sign-up API). must_change_password=0 so no first-run gate.
  const hash = bcrypt.hashSync(pass, 10)
  const addUser = db.prepare("INSERT OR REPLACE INTO users (username, password_hash, role, must_change_password) VALUES (?, ?, ?, 0)")
  addUser.run(admin, hash, 'admin')
  addUser.run(member, hash, 'member')

  // Everything else as the admin, over HTTP.
  let cookie = ''
  const call = async (method, url, body, okStatuses = [200, 201]) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await res.text()
    if (!okStatuses.includes(res.status)) throw new Error(`seed: ${method} ${url} -> HTTP ${res.status}: ${text.slice(0, 300)}`)
    const setCookie = res.headers.getSetCookie?.() ?? []
    if (setCookie.length) cookie = setCookie.map(c => c.split(';')[0]).join('; ')
    try { return JSON.parse(text) } catch { return text }
  }
  await call('POST', '/api/auth/login', { username: admin, password: pass })

  await call('POST', '/api/admin/workspaces', { slug: WS, name: 'E2E Workspace', short_label: 'E2E' })
  // A second workspace the member is NOT in, for the "not shared with you" case.
  await call('POST', '/api/admin/workspaces', { slug: 'e2e-private', name: 'E2E Private', short_label: 'PRV' })
  const memberId = db.prepare('SELECT id FROM users WHERE username = ?').get(member).id
  await call('POST', `/api/admin/workspaces/${WS}/users`, { user_id: memberId, username: member, role: 'member' })

  const project = await call('POST', '/api/projects', { workspace: WS, name: 'E2E Project', description: 'Seeded project' })
  const projectId = project.id ?? project.project?.id

  const card = async (title, extra = {}) => {
    const r = await call('POST', '/api/objectives', { title, description: `Seeded card: ${title}.`, workspace: WS, project_id: projectId, force: true, ...extra })
    return r.id ?? r.objective?.id
  }
  const cards = {
    queue: await card('E2E queue card'),
    working: await card('E2E working card'),
    aiReview: await card('E2E card in AI review'),
    reviewPass: await card('E2E card needing you (review passed)'),
    reviewFail: await card('E2E card needing you (review failed)'),
    reviewBlocked: await card('E2E card needing you (review blocked)'),
    done: await card('E2E done card'),
    parent: await card('E2E parent card'),
    longTitle: await card('E2E card with a very long title that should wrap or truncate cleanly instead of overflowing its column on a narrow screen, even when it has no spaces: ' + 'x'.repeat(60)),
    private: await card('E2E private card', { workspace: 'e2e-private', project_id: undefined }),
  }
  cards.child1 = await card('E2E sub-card one', { parent_id: cards.parent })
  cards.child2 = await card('E2E sub-card two', { parent_id: cards.parent })

  // Card states: SQL. Moving a card through the API starts a real worker session.
  const setState = db.prepare("UPDATE objectives SET status = ?, ai_review_verdict = ?, ai_review_findings = ?, updated_at = datetime('now') WHERE id = ?")
  setState.run('working', null, null, cards.working)
  setState.run('ai_review', null, null, cards.aiReview)
  setState.run('review', 'pass', 'All acceptance criteria met. Tests pass.', cards.reviewPass)
  setState.run('review', 'fail', 'Criterion 2 is not met: the empty state is missing.', cards.reviewFail)
  setState.run('review', 'blocked', 'The reviewer could not reach the preview.', cards.reviewBlocked)
  setState.run('done', 'pass', 'Looks good.', cards.done)

  // Notifications: SQL (POST /api/alerts needs a bearer token, not a login).
  const alert = db.prepare('INSERT INTO alerts (severity, source, title, message, url, acked_at) VALUES (?, ?, ?, ?, ?, ?)')
  alert.run('normal', 'e2e', 'E2E normal notification', 'A seeded notification.', `/o/${cards.queue}`, null)
  alert.run('high', 'e2e', 'E2E high notification', 'A seeded high-severity notification with a longer message to check wrapping in the panel.', null, null)
  alert.run('normal', 'e2e', 'E2E read notification', 'Already read.', null, new Date().toISOString())

  // Bot: give the seeded demo bot the workspace, and leave one message pair in its history.
  await call('POST', `/api/agent-chat/agents/${BOT}/workspaces`, { workspace: WS })
  await call('POST', `/api/agent-chat/agents/${BOT}/messages`, { text: 'Hello from the seed', client_msg_id: 'seed-hello-1' }, [200, 201, 202])

  // Workflow: one saved (never run) okflow/1 definition.
  const flow = await call('POST', '/api/flows', { workspace: WS, definition: {
    apiVersion: 'okflow/1', id: 'e2e-flow', name: 'E2E flow', workspace: WS, version: 1,
    goal: { statement: 'rows are fetched', end_condition: { assert: [{ expr: 'len(steps.fetch.output.rows) > 0' }] } },
    nodes: [
      { id: 'start', kind: 'trigger', on: 'schedule', schedule: { cron: '0 0 1 1 *' }, next: 'fetch' },
      { id: 'fetch', kind: 'tool', tool: 'rows-list', effect: 'read', retry: { max: 1, backoff: 'fixed', delay_ms: 1 }, mock: { output: { rows: [{ id: 'fixture' }] } }, next: 'verify' },
      { id: 'verify', kind: 'check', assert: [{ expr: 'len(steps.fetch.output.rows) > 0', why: 'rows fetched' }], next: 'done' },
      { id: 'done', kind: 'end', output: '{{ steps.fetch.output.rows }}' },
    ],
  } }, [200, 201, 400, 422]).catch(e => ({ error: String(e) }))

  // Knowledge base graph view sits behind the knowledge-import pack.
  const pack = await call('POST', '/api/starter-packs/knowledge-import/enable', { workspace: WS }, [200, 201, 409]).catch(e => ({ error: String(e) }))

  const manifest = { workspace: WS, privateWorkspace: 'e2e-private', projectId, cards, bots: [BOT], admin, member,
    flowSaved: !(flow && flow.error), graphPack: !(pack && pack.error) }
  if (process.env.E2E_SEED_FILE) fs.writeFileSync(process.env.E2E_SEED_FILE, JSON.stringify(manifest, null, 2))
  console.log('[seed] db:', JSON.stringify(manifest))
}
