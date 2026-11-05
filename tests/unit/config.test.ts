import { describe, expect, it } from 'vitest';
import { supabaseConfig } from '../../server/config';

describe('simplified deployment configuration', () => {
  it('uses the frontend public Supabase pair on the server', () => {
    expect(
      supabaseConfig({
        VITE_SUPABASE_URL: 'https://project.example',
        VITE_SUPABASE_ANON_KEY: 'synthetic-public-key',
        GEMINI_API_KEY: 'synthetic-private-key',
      }),
    ).toEqual({ url: 'https://project.example', key: 'synthetic-public-key' });
  });

  it('preserves complete server overrides without mixing partial pairs', () => {
    const env = {
      SUPABASE_URL: 'https://server.example',
      SUPABASE_ANON_KEY: 'server-public-key',
      VITE_SUPABASE_URL: 'https://frontend.example',
      VITE_SUPABASE_ANON_KEY: 'frontend-public-key',
    };
    expect(supabaseConfig(env)).toEqual({ url: env.SUPABASE_URL, key: env.SUPABASE_ANON_KEY });
    expect(supabaseConfig({ ...env, SUPABASE_ANON_KEY: '' })).toEqual({
      url: env.VITE_SUPABASE_URL,
      key: env.VITE_SUPABASE_ANON_KEY,
    });
  });

  it('fails clearly when a pair is incomplete', () => {
    expect(() => supabaseConfig({ VITE_SUPABASE_URL: 'https://project.example' })).toThrow(
      /주소와 공개 키/,
    );
    expect(() => supabaseConfig({})).toThrow(/Vercel/);
  });
});
