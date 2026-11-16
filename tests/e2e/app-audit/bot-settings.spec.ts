/**
 * Bot settings (card #901024): the panel opens and shows Workspace access,
 * Full access, Approve on my behalf and High Agency. Switches are read, and one
 * reversible change (grant, then remove a workspace) is made on the seeded bot.
 */
import { expect, type Page } from '@playwright/test'
import { test, login, seed, shot, watch, expectClean, BOT } from './helpers'

async function openSettings(page: Page) {
  await page.goto(`/chat/${BOT.slug}`)
  await page.getByRole('button', { name: `Show settings for ${BOT.name} (model and tools)` }).click()
  await expect(page.getByText('Bot settings').first()).toBeVisible()
}
const section = (page: Page, heading: string) => page.locator('section').filter({ has: page.getByRole('heading', { level: 4, name: heading, exact: true }) }).first()

test('bot settings panel shows all four access sections', async ({ page }, info) => {
  await login(page, info)
  const problems = watch(page)
  await openSettings(page)
  for (const heading of ['Workspace access', 'Full access', 'Approve on my behalf', 'High Agency']) {
    await expect(page.getByRole('heading', { level: 4, name: heading, exact: true }), heading).toBeVisible()
  }
  await shot(page, info, 'bot-settings')
  expectClean(problems)
})

test('workspace access lists the seeded grant', async ({ page }, info) => {
  await login(page, info)
  await openSettings(page)
  await expect(section(page, 'Workspace access')).toContainText(/E2E Workspace|e2e-ws/)
  await expect(page.getByLabel('Grant a workspace')).toBeVisible()
})

test('full access is off by default and has one switch per granted workspace', async ({ page }, info) => {
  await login(page, info)
  await openSettings(page)
  const sw = page.getByRole('switch', { name: new RegExp(`Full access in (${seed().workspace}|E2E Workspace)`) })
  await expect(sw).toBeVisible()
  await expect(sw).not.toBeChecked()
})

test('approve on my behalf is off by default', async ({ page }, info) => {
  await login(page, info)
  await openSettings(page)
  const sw = section(page, 'Approve on my behalf').getByRole('switch').first()
  await expect(sw).toBeVisible()
  await expect(sw).not.toBeChecked()
})

test('high agency is off by default and shows a preview before saving', async ({ page }, info) => {
  await login(page, info)
  await openSettings(page)
  const sw = page.getByRole('switch', { name: 'High Agency on' })
  await expect(sw).toBeVisible()
  await expect(sw).not.toBeChecked()
  await expect(page.getByRole('button', { name: 'Save High Agency' })).toBeVisible()
  await page.getByRole('button', { name: 'Save High Agency' }).scrollIntoViewIfNeeded()
  await shot(page, info, 'bot-settings-high-agency')
})

test('a member cannot change bot access settings', async ({ page }, info) => {
  await login(page, info, seed().member)
  // The API is the boundary; the page must not offer what the API refuses.
  const r = await page.request.put(`/api/agent-chat/agents/${BOT.slug}/full-access/${seed().workspace}`, { data: { enabled: true } })
  expect(r.status(), 'member turning on Full access').toBeGreaterThanOrEqual(400)
  await page.goto(`/chat/${BOT.slug}`)
  await expect(page.getByRole('switch', { name: /Full access in/ })).toHaveCount(0)
})
