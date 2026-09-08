import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'e2e/results',
  webServer: { command: 'npm run dev', port: 3000, reuseExistingServer: true, timeout: 120_000 },
  use: { baseURL: 'http://localhost:3000' },
  reporter: 'list',
});
