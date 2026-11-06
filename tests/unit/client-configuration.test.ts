import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => ({ auth: {} })) }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});
describe('browser connection initialization', () => {
  it('never initializes an auth client for a path-bearing project URL', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co/rest/v1');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'synthetic-public-key');
    const data = await import('../../src/lib/data');
    expect(data.supabase).toBeNull();
    expect(data.connection.ok).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });
  it('never initializes a browser client with a secret key', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_secret_synthetic');
    const data = await import('../../src/lib/data');
    expect(data.supabase).toBeNull();
    expect(createClient).not.toHaveBeenCalled();
  });
  it('uses persistent sessions for the personal journal on a valid origin', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', ' https://project.supabase.co/ ');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'synthetic-public-key');
    const data = await import('../../src/lib/data');
    expect(data.supabase).toBeTruthy();
    expect(createClient).toHaveBeenCalledWith(
      'https://project.supabase.co',
      'synthetic-public-key',
      {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      },
    );
  });
});
