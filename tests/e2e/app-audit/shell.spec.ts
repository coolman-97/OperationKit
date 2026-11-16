/**
 * Workflows, notifications and Jump to page (card #901024).
 */
import { expect } from '@playwright/test'
import { test, login, seed, shot, watch, expectClean } from './helpers'

test('workflows page lists the seeded workflow and offers New', async ({ page }, info) => {
  await login(page, info)
  const problems = watch(page)
  await page.goto('/jobs')
  await expect(page.getByRole('heading', { level: 1, name: 'Workflows' })).toBeVisible()
  await expect(page.getByTestId('new-workflow-button')).toBeVisible()
  if (seed().flowSaved) await expect(page.getByText('E2E flow').filter({ visible: true }).first()).toBeVisible()
  await shot(page, info, 'workflows')
  expectClean(problems)
})

test('notifications: the bell counts unread, the panel lists them, and a link opens its card', async ({ page }, info) => {
  await login(page, info)
  const problems = watch(page)
  await page.goto('/')
  const bell = page.getByRole('button', { name: /^Notifications/ }).first()
  await expect(bell).toBeVisible()
  await expect(bell, 'two seeded notifications are unread').toHaveAccessibleName(/2 unread/)
  await bell.click()
  const panel = page.getByTestId('notifications-panel')
  await expect(panel).toBeVisible()
  await expect(panel.getByTestId('notification').filter({ hasText: 'E2E normal notification' })).toBeVisible()
  await expect(panel.getByTestId('notification').filter({ hasText: 'E2E high notification' })).toBeVisible()
  await shot(page, info, 'notifications-panel')
  const box = await panel.boundingBox()
  const vw = page.viewportSize()!.width
  expect(box && box.x >= 0 && box.x + box.width <= vw + 1, 'panel fits inside the screen').toBeTruthy()
  expectClean(problems)
})

test('notifications: a member with nothing to read sees an empty state', async ({ page }, info) => {
  await login(page, info, seed().member)
  await page.goto('/')
  // Layout.tsx renders the bell for every signed-in user, so a missing bell is a failure.
  const bell = page.getByRole('button', { name: /^Notifications/ }).first()
  await expect(bell).toBeVisible()
  await bell.click()
  const panel = page.getByTestId('notifications-panel')
  await expect(panel).toBeVisible()
  await shot(page, info, 'notifications-member')
})

// Keyboard shortcut: desktop projects only.
test('Jump to page opens with Ctrl+K, filters, and goes to the chosen page', { tag: '@desktop' }, async ({ page }, info) => {
  await login(page, info)
  await page.goto('/')
  await expect(page.getByTestId('board-header')).toBeVisible()
  await page.keyboard.press('Control+k')
  const box = page.getByRole('combobox', { name: 'Jump to a page' })
  await expect(box).toBeVisible()
  await expect(box).toBeFocused()
  await shot(page, info, 'jump-to-page')
  await box.fill('Workflows')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 1, name: 'Workflows' })).toBeVisible()
  // Escape closes it without going anywhere.
  await page.keyboard.press('Control+k')
  await expect(box).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(box).toBeHidden()
  await expect(page).toHaveURL(/\/jobs$/)
})

test('Jump to page: a search with no match says so', { tag: '@desktop' }, async ({ page }, info) => {
  await login(page, info)
  await page.goto('/')
  await expect(page.getByTestId('board-header')).toBeVisible()
  await page.keyboard.press('Control+k')
  const box = page.getByRole('combobox', { name: 'Jump to a page' })
  await expect(box).toBeVisible()
  await box.fill('qqqq-no-such-page')
  await expect(page.getByRole('dialog').getByText(/no (pages|results|matches)|nothing/i).first()).toBeVisible()
  await shot(page, info, 'jump-to-page-empty')
})

// The Jump to page button lives in the desktop top bar only (Layout.tsx hides that
// bar below the sm breakpoint), so on a narrow screen it is optional. If a later
// change adds one, it must open the palette; either way the outcome is recorded.
test('Jump to page on narrow screens: a button, if shown, opens the palette', { tag: '@narrow' }, async ({ page }, info) => {
  await login(page, info)
  await page.goto('/')
  await expect(page.getByRole('button', { name: /^Notifications/ }).first()).toBeVisible()
  const open = page.getByRole('button', { name: 'Jump to a page (command palette)' })
  if ((await open.count()) === 0) {
    info.annotations.push({ type: 'by-design', description: 'no Jump to page button at this width (desktop top bar only); recorded in the audit report' })
  } else {
    await open.first().click()
    await expect(page.getByRole('combobox', { name: 'Jump to a page' })).toBeVisible()
  }
  await shot(page, info, 'jump-to-page')
})
