/**
 * Walk every page (card #901024): each one renders its landmark, in the theme
 * and width the project asks for, without console errors, failed requests or
 * sideways scroll. One full-page screenshot per page per project lands in
 * tests/smoke/app-audit/<project>/.
 */
import { expect } from '@playwright/test'
import { test, login, seed, shot, watch, expectClean, expectNoSidewaysScroll, expectTheme, BOT, KNOWN_CONSOLE_ERRORS } from './helpers'

interface Stop { name: string; path: () => string; landmark: (p: import('@playwright/test').Page) => import('@playwright/test').Locator; allow?: Array<string | RegExp> }

// Known bug, audit finding PA-7 (fix card drafted, not filed yet): on a fresh install two pages make a request that
// fails on load. Each has its own expected-fail test in api.spec.ts; the entries
// here keep the rest of that page's checks running. Delete them when the card ships.
const FRESH_INSTALL_503 = ['503 GET /api/admin/skill-graph', 'status of 503']
const FRESH_INSTALL_404 = ['404 GET /api/workspaces-config', 'status of 404']
const h1 = (text: string | RegExp) => (p: import('@playwright/test').Page) => p.getByRole('heading', { level: 1, name: text })

const STOPS: Stop[] = [
  { name: 'board', path: () => '/', landmark: p => p.getByTestId('board-header') },
  { name: 'board-workspace', path: () => `/w/${seed().workspace}`, landmark: p => p.getByTestId('board-header') },
  { name: 'archive', path: () => '/archive', landmark: h1('Archive') },
  { name: 'card-queue', path: () => `/o/${seed().cards.queue}`, landmark: p => p.getByRole('button', { name: 'Edit card' }).first() },
  { name: 'card-parent', path: () => `/o/${seed().cards.parent}`, landmark: p => p.getByRole('heading', { name: 'E2E parent card' }).first() },
  { name: 'card-review-pass', path: () => `/o/${seed().cards.reviewPass}`, landmark: p => p.getByRole('button', { name: 'Approve' }).first() },
  { name: 'card-review-fail', path: () => `/o/${seed().cards.reviewFail}`, landmark: p => p.getByRole('button', { name: 'Rework' }).first() },
  { name: 'bots', path: () => '/chat', landmark: h1('Bots') },
  { name: 'bot-chat', path: () => `/chat/${BOT.slug}`, landmark: p => p.locator(`section[aria-label="Conversation with ${BOT.name}"]`) },
  { name: 'context', path: () => '/knowledge', landmark: p => p.getByRole('button', { name: 'Graph', exact: true }) },
  { name: 'context-setup', path: () => '/knowledge/setup', landmark: h1('Set up your Context') },
  { name: 'workflows', path: () => '/jobs', landmark: h1('Workflows') },
  { name: 'bots-and-skills', path: () => '/agents', landmark: h1('Bots & skills'), allow: FRESH_INSTALL_503 },
  { name: 'system', path: () => '/system', landmark: h1('System') },
  { name: 'setup', path: () => '/setup', landmark: h1('Setup') },
  ...['models', 'api-mcp', 'integrations', 'secrets', 'workspaces', 'branding', 'email', 'knowledge-search'].map(tab => ({
    name: `settings-${tab}`, path: () => `/settings/${tab}`, landmark: (p: import('@playwright/test').Page) => p.getByTestId('settings-content'),
    allow: tab === 'workspaces' ? FRESH_INSTALL_404 : undefined,
  })),
]

for (const stop of STOPS) {
  test(`page: ${stop.name}`, async ({ page }, info) => {
    await login(page, info)
    const problems = watch(page)
    await page.goto(stop.path())
    await expect(stop.landmark(page)).toBeVisible()
    await expectTheme(page, info)
    await page.waitForLoadState('networkidle').catch(() => { /* pages that keep a live socket never go idle */ })
    await shot(page, info, stop.name)
    await expectNoSidewaysScroll(page)
    expectClean(problems, stop.allow)
  })
}

// Known bug, audit finding PA-4 (fix card drafted, not filed yet): index.html carries an inline script that sets the
// theme before first paint, and the server's own Content-Security-Policy
// (script-src 'self') blocks it, so every page logs a console error and the
// loading skeleton can flash in the wrong theme. helpers.ts keeps that one error
// out of the other tests (KNOWN_CONSOLE_ERRORS); this test is what tracks it.
test('first load: the page blocks none of its own scripts', async ({ page }, info) => {
  test.fail(true, 'Known bug — audit finding PA-4 (fix card drafted, not filed yet) (CSP blocks the inline pre-paint theme script in index.html)')
  const blocked: string[] = []
  page.on('console', m => { if (m.type() === 'error' && KNOWN_CONSOLE_ERRORS.some(k => k.match.test(m.text()))) blocked.push(m.text()) })
  await login(page, info)
  await page.goto('/')
  await expect(page.getByTestId('board-header')).toBeVisible()
  expect(blocked).toEqual([])
})

test('old addresses redirect instead of 404-ing', async ({ page }, info) => {
  await login(page, info)
  for (const [from, to] of [['/dashboard', /\/system$/], ['/settings/seats', /\/settings\/models$/], ['/docs', /\/knowledge$/], ['/feed', /\/$/]] as const) {
    await page.goto(from)
    await expect(page, `${from} should redirect`).toHaveURL(to)
  }
})

// The desktop top bar is hidden on narrow screens; the narrow menu is covered by the page walk.
test('primary navigation links go where they say', { tag: '@desktop' }, async ({ page }, info) => {
  await login(page, info)
  await page.goto('/')
  const nav = page.locator('nav[aria-label="Primary"]')
  for (const [link, heading] of [['Bots', 'Bots'], ['Context', 'Context'], ['Workflows', 'Workflows']] as const) {
    await nav.getByRole('link', { name: link, exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: heading, exact: true })).toBeVisible()
  }
  await nav.getByRole('link', { name: 'Board', exact: true }).click()
  await expect(page.getByTestId('board-header')).toBeVisible()
})
