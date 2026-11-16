// App-wide audit suite (card #901024). Run through run.sh, which boots a scratch
// server on a throwaway database, seeds it and exports E2E_BASE_URL.
// Not part of CI (see CLAUDE.md "Testing: Vitest via CLI; no Playwright MCP").
import { defineConfig } from '@playwright/test'

const desktop = { width: 1440, height: 900 }
const narrow = { width: 390, height: 844 }
const apiOnly = /api\.spec\.ts$/

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts$/,
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list'], ['json', { outputFile: process.env.E2E_REPORT_JSON || '/tmp/pw-app-audit/report.json' }]],
  outputDir: process.env.E2E_OUTPUT_DIR || '/tmp/pw-app-audit',
  use: { baseURL: process.env.E2E_BASE_URL, trace: 'retain-on-failure' },
  // Project names are "<theme>-<width>"; helpers.ts reads the theme from the name.
  // Scoping is done here, never by opting out inside a test (scripts/test-integrity.py):
  //  - tests tagged @desktop run in the desktop projects only, @narrow in the narrow ones;
  //  - api.spec.ts does not depend on theme or width, so it runs once, in light-desktop.
  projects: [
    { name: 'light-desktop', grepInvert: /@narrow/, use: { colorScheme: 'light', viewport: desktop } },
    { name: 'dark-desktop', grepInvert: /@narrow/, testIgnore: apiOnly, use: { colorScheme: 'dark', viewport: desktop } },
    { name: 'light-narrow', grepInvert: /@desktop/, testIgnore: apiOnly, use: { colorScheme: 'light', viewport: narrow, hasTouch: true, isMobile: true } },
    { name: 'dark-narrow', grepInvert: /@desktop/, testIgnore: apiOnly, use: { colorScheme: 'dark', viewport: narrow, hasTouch: true, isMobile: true } },
  ],
})
