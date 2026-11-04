import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  timeout: 45000,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1560, height: 1050 },
    timezoneId: 'Asia/Seoul',
    trace: 'retain-on-failure',
    launchOptions: {
      ...(process.env.CHROMIUM_PATH
        ? { executablePath: process.env.CHROMIUM_PATH }
        : existsSync('/usr/bin/chromium')
          ? { executablePath: '/usr/bin/chromium' }
          : {}),
      args: ['--no-sandbox'],
    },
  },
  webServer: {
    command:
      process.env.PLAYWRIGHT_PRODUCTION === '1'
        ? 'npm run preview -- --port 4173 --strictPort'
        : 'npm run dev -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: 'https://test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'synthetic-public-key-not-a-real-credential',
    },
  },
});
