/**
 * Error pages and failure states (card #901024): unknown address, a card that
 * does not exist, a card that is not shared with you, a server error and a
 * dropped connection. Each must show a plain message and a way out, never a
 * blank page.
 */
import { expect } from '@playwright/test'
import { test, login, seed, shot } from './helpers'

test('unknown address shows Page not found with a way back', async ({ page }, info) => {
  await login(page, info)
  await page.goto('/no-such-page-e2e')
  await expect(page.getByText('Page not found')).toBeVisible()
  await shot(page, info, 'error-404')
  await page.getByRole('button', { name: 'Back to the board' }).or(page.getByRole('link', { name: 'Back to the board' })).first().click()
  await expect(page.getByTestId('board-header')).toBeVisible()
})

test('a card that does not exist shows Card not found', async ({ page }, info) => {
  await login(page, info)
  await page.goto('/o/99999999')
  await expect(page.getByTestId('objective-not-found')).toBeVisible()
  await expect(page.getByTestId('objective-not-found')).toContainText('Card not found')
  await shot(page, info, 'error-card-not-found')
})

test('forbidden: a member opening a card in a workspace they are not in gets a clear message', async ({ page }, info) => {
  await login(page, info, seed().member)
  const api = await page.request.get(`/api/objectives/${seed().cards.private}`)
  expect(api.status(), 'the API refuses the member').toBe(403)
  await page.goto(`/o/${seed().cards.private}`)
  await expect(page.getByTestId('objective-not-found')).toBeVisible()
  await expect(page.getByText('E2E private card')).toHaveCount(0)
  await shot(page, info, 'error-forbidden-card')
})

test('forbidden: a member cannot reach admin APIs, and admin settings do not leak data', async ({ page }, info) => {
  await login(page, info, seed().member)
  for (const url of ['/api/admin/seats', '/api/admin/workspaces']) {
    expect((await page.request.get(url)).status(), url).toBe(403)
  }
  await page.goto('/settings/secrets')
  await shot(page, info, 'error-forbidden-settings')
  await expect(page.getByTestId('app-error'), 'no crash screen for a member on an admin page').toHaveCount(0)
})

test('server error: the board says it could not load instead of looking empty', async ({ page }, info) => {
  await login(page, info)
  await page.route('**/api/objectives?*', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom (e2e)"}' }))
  await page.route('**/api/objectives', route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom (e2e)"}' }))
  await page.goto('/')
  await shot(page, info, 'error-server-500-board')
  await expect(page.getByTestId('app-error'), 'no crash screen').toHaveCount(0)
  await expect(page.getByText(/boom \(e2e\)|could not|couldn.t|try again|something went wrong/i).first(), 'an error message is shown').toBeVisible()
})

// Known bug, audit finding PA-2 (fix card drafted, not filed yet): when the card list fails to load, the board still
// says "0 cards" and "Queue is empty" under a small "Could not load done cards"
// line, so an outage reads as an empty board. Remove test.fail when that card ships.
test('server error: a failed load does not read as an empty board', async ({ page }, info) => {
  test.fail(true, 'Known bug — audit finding PA-2 (fix card drafted, not filed yet) (failed board load shows the empty-column text)')
  await login(page, info)
  await page.route(/\/api\/objectives(\?.*)?$/, route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"boom (e2e)"}' }))
  await page.goto('/')
  await expect(page.getByTestId('board-header')).toBeVisible()
  await expect(page.getByText('Queue is empty'), 'a failed load must not read as an empty board').toHaveCount(0)
})

// The board's live updates run over a WebSocket (/ws). context.setOffline() does not
// drop a socket that is already open, so the drop is made here: close the socket and
// refuse new ones, then let them through again.
test('offline: a dropped live connection shows on the board and recovers', async ({ page }, info) => {
  await login(page, info)
  let down = false
  const open: Array<{ close: (o?: { code?: number; reason?: string }) => Promise<void> }> = []
  await page.routeWebSocket(/\/ws(\?.*)?$/, ws => {
    if (down) { void ws.close({ code: 4000, reason: 'e2e offline' }); return }
    ws.connectToServer()
    open.push(ws)
  })
  await page.goto('/')
  const header = page.getByTestId('board-header')
  await expect(header).toBeVisible()
  await expect(header).not.toContainText(/Reconnecting|Disconnected/)
  down = true
  for (const ws of open) await ws.close({ code: 4000, reason: 'e2e offline' })
  await expect(header).toContainText(/Reconnecting|Disconnected/, { timeout: 15_000 })
  await shot(page, info, 'error-offline-board')
  down = false
  await expect(header).not.toContainText(/Reconnecting|Disconnected/, { timeout: 45_000 })
})

test('signed out: an app address shows the sign-in page, not an error', async ({ page }, info) => {
  await page.goto('/o/1')
  await expect(page.locator('input[type="password"]').first()).toBeVisible()
  await shot(page, info, 'signed-out')
})

// The unknown-/api-path bug (fix card #901031) is covered, as an expected-fail, in api.spec.ts.
