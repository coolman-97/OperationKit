/**
 * Context / knowledge base (card #901024): the page list shows the seeded
 * pages, a page opens, search finds a seeded word and says so when nothing
 * matches, the graph view opens, and the setup page renders.
 */
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test'
import { test, login, seed, shot, watch, expectClean, isNarrow } from './helpers'

/** On a narrow screen the page list, its heading and the search live in a drawer. */
async function openContext(page: Page, info: TestInfo): Promise<Page | Locator> {
  await page.goto('/knowledge')
  if (!isNarrow(info)) {
    await expect(page.getByRole('heading', { level: 1, name: 'Context' })).toBeVisible()
    return page
  }
  await page.getByRole('button', { name: 'Open the page list' }).click()
  const drawer = page.getByRole('dialog', { name: 'Pages' })
  await expect(drawer.getByRole('heading', { level: 1, name: 'Context' })).toBeVisible()
  return drawer
}

test('context lists the seeded pages and opens one', async ({ page }, info) => {
  await login(page, info)
  const problems = watch(page)
  const list = await openContext(page, info)
  const tree = list.getByRole('tree', { name: 'Pages' })
  await expect(tree).toBeVisible()
  await shot(page, info, 'context-list')
  // The tree starts collapsed at the vault root: workspaces > <workspace> > pages.
  await tree.getByRole('treeitem', { name: 'workspaces' }).click()
  await tree.getByRole('treeitem', { name: seed().workspace, exact: true }).click()
  await shot(page, info, 'context-tree-open')
  await tree.getByText('README', { exact: false }).first().click()
  await expect(page.getByText('Seeded knowledge base for the audit suite.').first()).toBeVisible()
  await shot(page, info, 'context-page-open')
  expectClean(problems)
})

test('context search finds a seeded word', async ({ page }, info) => {
  await login(page, info)
  const list = await openContext(page, info)
  const search = list.getByLabel('Search Context')
  await search.fill('zebracorn')
  await search.press('Enter')
  const results = list.getByLabel('Search results')
  await expect(results).toBeVisible()
  await expect(results.getByText(/zebracorn/i).first()).toBeVisible()
  await shot(page, info, 'context-search-results')
})

test('context search with no match shows an empty state, not a blank panel', async ({ page }, info) => {
  await login(page, info)
  const list = await openContext(page, info)
  const search = list.getByLabel('Search Context')
  await search.fill('qqqq-no-such-word-zzzz')
  await search.press('Enter')
  await expect(list.getByRole('search').locator('..').getByText(/no (pages|results|matches)|nothing/i).first()).toBeVisible()
  await shot(page, info, 'context-search-empty')
})

test('context graph view opens', async ({ page }, info) => {
  // The Graph toggle sits behind the knowledge-import pack, which the seed must have enabled.
  expect(seed().graphPack, 'seed.mjs enabled the knowledge-import pack').toBe(true)
  await login(page, info)
  const problems = watch(page)
  await page.goto('/knowledge')
  const toggle = page.getByRole('button', { name: 'Graph', exact: true })
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('heading', { level: 2, name: 'How your Context connects' })).toBeVisible()
  // The graph is per workspace; pick the seeded one and expect its pages as dots.
  // Chosen by keyboard, which works the same for the desktop popover and the phone sheet.
  const picker = page.getByRole('combobox', { name: 'Workspace' }).filter({ visible: true }).last()
  const option = page.getByRole('option', { name: 'E2E Workspace' })
  await picker.focus()
  await page.keyboard.press('Enter')
  await expect(option).toBeVisible()
  for (let i = 0; i < 5 && (await option.getAttribute('data-highlighted')) === null; i++) await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  await expect(picker).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('group', { name: /^Graph of \d+ Context pages/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Open Zebracorn/ })).toBeVisible()
  await shot(page, info, 'context-graph')
  expectClean(problems)
})

test('context setup page shows the drop zone', async ({ page }, info) => {
  await login(page, info)
  await page.goto('/knowledge/setup')
  await expect(page.getByRole('heading', { level: 1, name: 'Set up your Context' })).toBeVisible()
  await expect(page.getByTestId('kb-dropzone')).toBeVisible()
  await shot(page, info, 'context-setup')
})
