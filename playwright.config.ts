// Playwright looks for this by name at the repo root, so unlike the tsconfigs it
// can't move into a folder.
//
// A real browser is non-negotiable here: moveCaret() preserves the caret's visual
// x-position using canvas measureText(), and caret/selection semantics are the
// thing under test. jsdom implements neither properly — it would pass while the
// real thing broke.
import { defineConfig, devices } from '@playwright/test';

const PORT = 8787;

export default defineConfig({
  testDir: './test',
  fullyParallel: false, // one Durable Object, one tree — tests share it and wipe it
  workers: 1,
  reporter: [['list']],

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure', // replays a failing test keystroke by keystroke
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  // Storage lives in its own directory, so a test run can never touch the tree you
  // use in `npm run dev`. Tests still wipe and re-seed per test (see layTree).
  webServer: {
    command: `npx wrangler dev --port ${PORT} --persist-to .wrangler/test-state`,
    url: `http://localhost:${PORT}/scratchpad`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
