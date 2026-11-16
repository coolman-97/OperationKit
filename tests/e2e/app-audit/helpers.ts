/**
 * Shared helpers for the app-wide audit suite (card #901024).
 * Project names are "<theme>-<width>" (see playwright.config.ts).
 */
import { test as base, chromium, expect, type Browser, type Page, type TestInfo } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

/**
 * The suite's `test`. In an Operation Kit card session the only browser is the
 * pinned, sandboxed Chromium behind the egress guard, and it must be started
 * through its launcher (CC_BROWSER_LAUNCHER). Anywhere else this is the stock
 * Chromium that `playwright install` put on the machine.
 */
export const test = base.extend<object, { browser: Browser }>({
  browser: [async ({}, use) => {
    const launcher = process.env.CC_BROWSER_LAUNCHER
    const browser: Browser = launcher
      ? await (await import(/* webpackIgnore: true */ launcher)).launch()
      : await chromium.launch()
    await use(browser)
    await browser.close()
  }, { scope: 'worker' }],
})

export const SHOTS = process.env.E2E_SHOTS_DIR || path.resolve(__dirname, '../../smoke/app-audit')
export const ADMIN = process.env.E2E_ADMIN_USER || 'e2e-admin'
export const MEMBER = process.env.E2E_MEMBER_USER || 'e2e-member'
export const PASS = process.env.E2E_PASS || ''

/** What seed.mjs created (ids of cards, bot slugs, ...). Written by run.sh. */
export interface Seed {
  workspace: string
  privateWorkspace: string
  projectId: number
  cards: Record<"queue" | "working" | "aiReview" | "reviewPass" | "reviewFail" | "reviewBlocked" | "done" | "parent" | "child1" | "child2" | "longTitle" | "private", number>
  bots: string[]
  admin: string
  member: string
  flowSaved: boolean
  graphPack: boolean
}
export function seed(): Seed {
  const file = process.env.E2E_SEED_FILE
  if (!file || !fs.existsSync(file)) throw new Error('E2E_SEED_FILE is missing — run the suite through run.sh')
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Seed
}

export const themeOf = (info: TestInfo): 'light' | 'dark' => (info.project.name.startsWith('dark') ? 'dark' : 'light')
export const isNarrow = (info: TestInfo): boolean => info.project.name.endsWith('narrow')

export async function login(page: Page, info: TestInfo, user: string = ADMIN): Promise<void> {
  const theme = themeOf(info)
  await page.addInitScript(t => { localStorage.setItem('ok-theme', t) }, theme)
  const r = await page.request.post('/api/auth/login', { data: { username: user, password: PASS } })
  expect(r.status(), `login as ${user}`).toBe(200)
}

/** Full-page screenshot at tests/smoke/app-audit/<project>/<name>.png. */
export async function shot(page: Page, info: TestInfo, name: string): Promise<string> {
  const dir = path.join(SHOTS, info.project.name)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${name}.png`)
  await page.waitForTimeout(250)
  await page.screenshot({ path: file, fullPage: true })
  await info.attach(name, { path: file, contentType: 'image/png' })
  return file
}

/**
 * Console errors that every page logs because of a known bug. Each one has its
 * own expected-fail test (so it is still tracked and flips to "unexpected pass"
 * when fixed) and a fix card; listing it here keeps one known bug from turning
 * every other page test red. Delete the entry when its card ships.
 */
export const KNOWN_CONSOLE_ERRORS: Array<{ match: RegExp; card: string }> = [
  // index.html's inline pre-paint theme script is blocked by the server's own CSP (script-src 'self').
  { match: /Executing inline script violates the following Content Security Policy directive/, card: 'PA-4 (audit finding; fix card drafted, not filed yet)' },
]

export interface PageProblems {
  consoleErrors: string[]
  pageErrors: string[]
  failedRequests: string[]
  badResponses: string[]
}

/**
 * Record console errors, uncaught exceptions, failed requests and 4xx/5xx API
 * responses while a page is used. Call at the start of a test, assert with
 * expectClean() at the end. `allow` lists substrings that are expected (for
 * example the 404 a not-found test triggers on purpose).
 */
export function watch(page: Page): PageProblems {
  const p: PageProblems = { consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [] }
  page.on('console', m => { if (m.type() === 'error' && !KNOWN_CONSOLE_ERRORS.some(k => k.match.test(m.text()))) p.consoleErrors.push(m.text()) })
  page.on('pageerror', e => p.pageErrors.push(String(e)))
  page.on('requestfailed', r => {
    const why = r.failure()?.errorText || ''
    // Navigating away aborts in-flight polls; that is not a failure of the app.
    if (!/ERR_ABORTED/.test(why)) p.failedRequests.push(`${r.method()} ${r.url()} ${why}`)
  })
  page.on('response', r => {
    if (r.status() >= 400 && new URL(r.url()).pathname.startsWith('/api/')) {
      p.badResponses.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`)
    }
  })
  return p
}

export function expectClean(p: PageProblems, allow: Array<string | RegExp> = []): void {
  const ok = (line: string) => allow.some(a => (typeof a === 'string' ? line.includes(a) : a.test(line)))
  const left = {
    consoleErrors: p.consoleErrors.filter(l => !ok(l)),
    pageErrors: p.pageErrors.filter(l => !ok(l)),
    failedRequests: p.failedRequests.filter(l => !ok(l)),
    badResponses: p.badResponses.filter(l => !ok(l)),
  }
  expect(left, 'console errors / failed requests on this page').toEqual({
    consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [],
  })
}

/** No horizontal overflow: the page must not scroll sideways at this width. */
export async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(over, 'page is wider than the viewport (horizontal scroll)').toBeLessThanOrEqual(1)
}

/** The theme the test asked for is the theme the page actually rendered. */
export async function expectTheme(page: Page, info: TestInfo): Promise<void> {
  await expect(page.locator('html')).toHaveAttribute('data-theme', themeOf(info))
}

/** The custom brand run.sh boots the server with (never the default name). */
export const BRAND = process.env.E2E_BRAND_NAME || "Acme Ops"
/** The seeded demo bot (seed.mjs). */
export const BOT = { slug: "e2e-helper", name: "E2E Helper" }

/**
 * Block the calls that would start a real worker session or change a card for
 * good, and report which ones the UI tried to make. Start / Rework / Reopen run
 * startSession on the server even on a scratch instance, so the suite never lets
 * a status change through.
 */
export async function blockStatusChanges(page: Page): Promise<string[]> {
  const seen: string[] = []
  await page.route(/\/api\/objectives\/\d+\/(status|start|rework|approve|reopen)\b.*/, async route => {
    seen.push(route.request().method() + " " + new URL(route.request().url()).pathname)
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" })
  })
  return seen
}
