import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';


export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: {
          configPath: "./wrangler.jsonc",
          compatibilityFlags: [
            'nodejs_compat',
            'enable_nodejs_tty_module',
            'enable_nodejs_fs_module',
            'enable_nodejs_http_modules',
            'enable_nodejs_perf_hooks_module',
          ],
        },
      },
    },
  }
});
