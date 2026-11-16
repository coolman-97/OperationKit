/**
 * Bots page, sidebar and bot chat (card #901024). The seeded bot uses the
 * built-in demo provider, so replies need no AI account. A slow reply is faked
 * in the browser (page.route delays the send call) to hold the bot "working".
 */
import { expect, type Page } from '@playwright/test'
import { test, login, shot, watch, expectClean, BOT } from './helpers'

const input = (page: Page) => page.locator('#agent-chat-input')
const userBubbles = (page: Page, text: string) => page.getByText(text, { exact: true })

test('bots page lists the seeded bot and filters by name', async ({ page }, info) => {
  await login(page, info)
  const problems = watch(page)
  await page.goto('/chat')
  await expect(page.getByRole('heading', { level: 1, name: 'Bots' })).toBeVisible()
  const filter = page.getByLabel('Filter bots by name or message')
  await expect(page.getByText(BOT.name).first()).toBeVisible()
  await shot(page, info, 'bots-sidebar')
  await filter.fill('zzz-no-such-bot')
  await expect(page.getByText(BOT.name)).toHaveCount(0)
  await shot(page, info, 'bots-sidebar-no-match')
  await filter.fill('e2e')
  await expect(page.getByText(BOT.name).first()).toBeVisible()
  expectClean(problems)
})

test('send a message: it appears once and the bot answers', async ({ page }, info) => {
  await login(page, info)
  const problems = watch(page)
  await page.goto(`/chat/${BOT.slug}`)
  const text = `single send ${info.project.name} ${Date.now()}`
  await input(page).fill(text)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(userBubbles(page, text)).toHaveCount(1)
  await expect(page.getByText(/I'm the demo version of E2E Helper/).last()).toBeVisible()
  await expect(input(page)).toHaveValue('')
  await shot(page, info, 'chat-reply')
  expectClean(problems)
})

test('Enter plus a click sends one message, not two', async ({ page }, info) => {
  await login(page, info)
  await page.goto(`/chat/${BOT.slug}`)
  const text = `double submit ${info.project.name} ${Date.now()}`
  let posts = 0
  page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith(`/agents/${BOT.slug}/messages`)) posts++ })
  await input(page).fill(text)
  await Promise.all([input(page).press('Enter'), page.getByRole('button', { name: 'Send', exact: true }).click({ force: true }).catch(() => {})])
  await expect(userBubbles(page, text)).toHaveCount(1)
  await page.reload()
  await expect(userBubbles(page, text), 'still one copy after a reload').toHaveCount(1)
  expect(posts, 'POSTs for one draft').toBe(1)
})

test('send while the bot is working: the second message queues and nothing doubles', async ({ page }, info) => {
  await login(page, info)
  await page.goto(`/chat/${BOT.slug}`)
  const first = `slow first ${info.project.name} ${Date.now()}`
  const second = `queued second ${info.project.name} ${Date.now()}`
  // Hold the first send for 4s so the page stays in its "working" state.
  let held = false
  await page.route(`**/api/agent-chat/agents/${BOT.slug}/messages`, async route => {
    if (route.request().method() === 'POST' && !held) { held = true; await new Promise(r => setTimeout(r, 4000)) }
    await route.continue()
  })
  await input(page).fill(first)
  await input(page).press('Enter')
  await expect(page.getByTestId('bot-working')).toBeVisible()
  await expect(page.getByTestId('bot-working')).toContainText(`${BOT.name} is working`)
  await input(page).fill(second)
  await input(page).press('Enter')
  await shot(page, info, 'chat-send-while-working')
  // Both land exactly once, in order, once the bot has caught up.
  await expect(page.getByTestId('bot-working')).toBeHidden({ timeout: 20_000 })
  await expect(userBubbles(page, first)).toHaveCount(1)
  await expect(userBubbles(page, second)).toHaveCount(1)
  await page.reload()
  await expect(userBubbles(page, first), 'first message after reload').toHaveCount(1)
  await expect(userBubbles(page, second), 'second message after reload').toHaveCount(1)
})

test('refresh mid-reply: the message is kept once and the reply still arrives', async ({ page }, info) => {
  await login(page, info)
  await page.goto(`/chat/${BOT.slug}`)
  const text = `refresh mid reply ${info.project.name} ${Date.now()}`
  // Delay only the RESPONSE: the server has the message, the page has not heard back.
  await page.route(`**/api/agent-chat/agents/${BOT.slug}/messages`, async route => {
    if (route.request().method() !== 'POST') return route.continue()
    const res = await route.fetch()
    await new Promise(r => setTimeout(r, 5000))
    await route.fulfill({ response: res }).catch(() => { /* page reloaded */ })
  })
  await input(page).fill(text)
  await input(page).press('Enter')
  await expect(userBubbles(page, text)).toHaveCount(1)
  await page.waitForTimeout(1500)
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await page.reload()
  await shot(page, info, 'chat-after-refresh-mid-reply')
  await expect(userBubbles(page, text), 'one copy after the refresh').toHaveCount(1)
  await expect(page.getByText(/I'm the demo version of E2E Helper/).last()).toBeVisible()
  await expect(page.getByTestId('bot-working'), 'no stuck "working" state after the refresh').toBeHidden({ timeout: 20_000 })
})

test('a failed send shows an error and keeps the text', async ({ page }, info) => {
  await login(page, info)
  await page.goto(`/chat/${BOT.slug}`)
  await page.route(`**/api/agent-chat/agents/${BOT.slug}/messages`, route => (route.request().method() === 'POST' ? route.abort('failed') : route.continue()))
  const text = `offline send ${info.project.name}`
  await input(page).fill(text)
  await input(page).press('Enter')
  await expect(page.getByRole('alert').first(), 'the failure is announced').toBeVisible()
  await shot(page, info, 'chat-send-failed')
  // The words must not be lost: still in the box, or shown as an unsent message.
  const kept = (await input(page).inputValue()) === text || (await userBubbles(page, text).count()) > 0
  expect(kept, 'the unsent text is still on screen').toBeTruthy()
})

test('narrow screens: the chat composer stays inside the viewport', { tag: '@narrow' }, async ({ page }, info) => {
  await login(page, info)
  await page.goto(`/chat/${BOT.slug}`)
  const box = await input(page).boundingBox()
  const vw = page.viewportSize()!.width
  expect(box && box.x >= 0 && box.x + box.width <= vw + 1, 'composer fits the screen width').toBeTruthy()
})

// Known bug, audit finding PA-6 (fix card drafted, not filed yet): a send that cannot reach the server shows the
// browser's raw "Failed to fetch" instead of the app's own plain-language message
// (lib/format.ts). Remove test.fail when that card ships.
test('a failed send explains itself in plain words', async ({ page }, info) => {
  test.fail(true, 'Known bug — audit finding PA-6 (fix card drafted, not filed yet) (chat shows raw "Failed to fetch")')
  await login(page, info)
  await page.goto(`/chat/${BOT.slug}`)
  await page.route(`**/api/agent-chat/agents/${BOT.slug}/messages`, route => (route.request().method() === 'POST' ? route.abort('failed') : route.continue()))
  await input(page).fill(`offline copy ${info.project.name}`)
  await input(page).press('Enter')
  await expect(page.getByRole('alert').first()).toBeVisible()
  await expect(page.getByRole('alert').first()).not.toContainText('Failed to fetch', { timeout: 2000 })
})
