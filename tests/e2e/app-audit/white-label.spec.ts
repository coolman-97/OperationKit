/**
 * White-label and one-accent checks (card #901024). run.sh boots the server
 * with a custom brand name, so any page that still shows the default product
 * name has it hard-coded somewhere.
 */
import { expect, type Page } from '@playwright/test'
import { test, login, seed, BRAND, BOT, themeOf } from './helpers'

const VENDOR = /Operation ?Kit|Command Center|Example/i
const visibleText = (page: Page) => page.evaluate(() => document.body.innerText)

const PAGES = ['/', '/archive', '/knowledge', '/knowledge/setup', '/jobs', '/agents', '/system', '/settings/models', '/settings/branding', '/settings/integrations', '/no-such-page-e2e']

test('the custom brand name is used for the page title', async ({ page }, info) => {
  await login(page, info)
  await page.goto('/')
  await expect(page).toHaveTitle(new RegExp(BRAND))
})

for (const path of PAGES) {
  test(`no vendor name on ${path} under a custom brand`, async ({ page }, info) => {
    // Known bug, fix card #901033: /agents lists the built-in bot "Operation Kit Dev". Remove when that card ships.
    test.fail(path === '/agents', 'Known bug — fix card #901033 (built-in bot "Operation Kit Dev" on Bots & skills)')
    await login(page, info)
    await page.goto(path)
    await page.waitForLoadState('networkidle').catch(() => {})
    const hits = (await visibleText(page)).split('\n').filter(l => VENDOR.test(l))
    expect(hits, `lines that show a vendor name on ${path}`).toEqual([])
    expect(await page.title()).not.toMatch(VENDOR)
  })
}

// Known bug, fix card #901033: the built-in bots are named and described with
// "Operation Kit" whatever the brand is. Remove test.fail when that card ships.
test('bots page shows no vendor name under a custom brand', async ({ page }, info) => {
  test.fail(true, 'Known bug — fix card #901033 (built-in bot "Operation Kit Dev", author "Operation Kit")')
  await login(page, info)
  await page.goto('/chat')
  await expect(page.getByText(BOT.name).first()).toBeVisible()
  const hits = (await visibleText(page)).split('\n').filter(l => VENDOR.test(l))
  expect(hits).toEqual([])
})

test('sign-in page shows the custom brand, not the vendor name', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('input[type="password"]').first()).toBeVisible()
  expect(await visibleText(page)).not.toMatch(VENDOR)
})

/**
 * One accent colour: every filled primary button on the main pages uses the
 * same background colour (the --accent token). Reads computed styles, so it
 * catches a second accent that a screenshot review might miss.
 */
/** "rgb(43, 43, 232)" and "color(srgb 0.168627 0.168627 0.909804)" are the same colour: compare as r,g,b. */
function rgb(css: string): string {
  const srgb = css.match(/^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)/)
  if (srgb) return srgb.slice(1, 4).map(v => Math.round(Number(v) * 255)).join(',')
  const m = css.match(/^rgba?\((\d+), (\d+), (\d+)/)
  return m ? m.slice(1, 4).join(',') : css
}

test('filled primary buttons share one accent colour', async ({ page }, info) => {
  await login(page, info)
  const accent = async () => page.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.background = 'var(--accent)'
    document.body.appendChild(probe)
    const c = getComputedStyle(probe).backgroundColor
    probe.remove()
    return c
  }).then(rgb)
  await page.goto('/')
  const want = await accent()
  for (const [path, name] of [[`/w/${seed().workspace}`, 'New'], ['/jobs', /New/], [`/chat/${BOT.slug}`, 'Send']] as const) {
    await page.goto(path)
    const button = page.getByRole('button', { name, exact: typeof name === 'string' }).first()
    await expect(button).toBeVisible()
    // Send is greyed out until there is something to send.
    if (name === 'Send') { await page.locator('#agent-chat-input').fill('accent check'); await expect(button).toBeEnabled() }
    // Read the colour once it has settled (buttons fade between states).
    const colour = () => button.evaluate(el => getComputedStyle(el).backgroundColor).then(rgb)
    await expect.poll(colour, `${path} "${String(name)}" (${themeOf(info)})`).toBe(want)
  }
})
