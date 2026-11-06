import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { authErrorText, validateConnection } from '../../src/domain/connection';
import { supabaseConfig } from '../../server/config';
afterEach(() => vi.unstubAllGlobals());

describe('public project URL validation', () => {
  it('accepts and normalizes project roots, custom HTTPS domains and loopback development', () => {
    for (const url of [
      'https://project.supabase.co',
      'https://project.supabase.co/',
      'https://auth.example.test',
      'http://localhost:54321/',
    ]) {
      expect(validateConnection(url, 'sb_publishable_synthetic')).toEqual({
        ok: true,
        url: new URL(url).origin,
        key: 'sb_publishable_synthetic',
      });
    }
  });
  it('automatically removes known hosted service bases without changing the project', () => {
    for (const suffix of [
      '/rest/v1',
      '/rest/v1/',
      '/auth/v1',
      '/auth/v1/',
      '/storage/v1',
      '/storage/v1/',
    ]) {
      expect(
        validateConnection(
          'https://synthetic-project.supabase.co' + suffix,
          'synthetic-public-key',
        ),
      ).toEqual({
        ok: true,
        url: 'https://synthetic-project.supabase.co',
        key: 'synthetic-public-key',
      });
    }
  });
  it('rejects dashboard, deployment, storage and path-bearing addresses before signup', () => {
    for (const url of [
      'https://supabase.com/dashboard/project/example',
      'https://project.supabase.co/rest/v1/auction_records',
      'https://project.supabase.co/auth/v1/signup',
      'https://auth.example.test/rest/v1/',
      'https://project.supabase.co/other',
      'https://project.supabase.co/?key=private-value',
      'https://madang.vercel.app',
      'https://project.storage.supabase.co',
      'https://db.project.supabase.co',
      'postgresql://postgres:private-value@db.project.supabase.co/postgres',
      'not a URL',
      'https://project.supabase.co/#api',
    ]) {
      const checked = validateConnection(url, 'synthetic-public-key');
      expect(checked.ok, url).toBe(false);
      expect(JSON.stringify(checked)).not.toContain('private-value');
    }
  });
  it('blocks secret keys without ever echoing their values', () => {
    const secret = 'sb_secret_synthetic_never_echo';
    const serviceKey =
      'eyJhbGciOiJIUzI1NiJ9.' + btoa(JSON.stringify({ role: 'service_role' })) + '.synthetic';
    for (const key of [
      secret,
      serviceKey,
      '"public-key"',
      'VITE_SUPABASE_ANON_KEY=some-value',
      'https://example.com/key',
    ]) {
      const checked = validateConnection('https://project.supabase.co', key);
      expect(checked.ok).toBe(false);
      expect(JSON.stringify(checked)).not.toContain(key);
    }
  });
  it('normalizes server configuration too and rejects ambiguous paths', () => {
    expect(
      supabaseConfig({
        VITE_SUPABASE_URL: 'https://project.supabase.co/rest/v1/',
        VITE_SUPABASE_ANON_KEY: 'public-key',
      }),
    ).toEqual({ url: 'https://project.supabase.co', key: 'public-key' });
    expect(
      supabaseConfig({
        SUPABASE_URL: 'https://project.supabase.co/rest/v1/',
        SUPABASE_ANON_KEY: 'public-key',
      }),
    ).toEqual({ url: 'https://project.supabase.co', key: 'public-key' });
    expect(() =>
      supabaseConfig({
        VITE_SUPABASE_URL: 'https://project.supabase.co/other',
        VITE_SUPABASE_ANON_KEY: 'public-key',
      }),
    ).toThrow(/경로/);
  });
  it('calls the SDK signup endpoint correctly after automatic normalization', async () => {
    const checked = validateConnection(
      'https://synthetic-project.supabase.co/rest/v1/',
      'synthetic-public-key',
    );
    if (!checked.ok) throw new Error('Expected normalized settings');
    const requests: string[] = [];
    const client = createClient(checked.url, checked.key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: async (input) => {
          requests.push(String(input));
          return new Response(
            JSON.stringify({
              id: '11111111-1111-4111-8111-111111111111',
              email: 'synthetic@example.test',
              aud: 'authenticated',
              created_at: '2026-01-01T00:00:00Z',
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        },
      },
    });
    const result = await client.auth.signUp({
      email: 'synthetic@example.test',
      password: 'synthetic-password',
    });
    expect(result.error).toBeNull();
    expect(new URL(requests[0]).pathname).toBe('/auth/v1/signup');
    expect(new URL(requests[0]).origin).toBe('https://synthetic-project.supabase.co');
  });
  it('reproduces the SDK path duplication and replaces opaque auth errors with corrective steps', async () => {
    const requests: string[] = [];
    const client = createClient('https://project.supabase.co/rest/v1', 'synthetic-public-key', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: async (input) => {
          requests.push(String(input));
          return new Response(
            JSON.stringify({ message: 'Invalid path specified in request URL' }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          );
        },
      },
    });
    const { error } = await client.auth.signUp({
      email: 'synthetic@example.test',
      password: 'synthetic-password',
    });
    expect(new URL(requests[0]).pathname).toBe('/rest/v1/auth/v1/signup');
    expect(error).toBeTruthy();
    expect(authErrorText(error)).toMatch(/VITE_SUPABASE_URL/);
    expect(authErrorText(error)).toMatch(/Redeploy/);
  });
  it('explains confirmed-email and invalid-key errors without suggesting a public data bypass', () => {
    expect(authErrorText(new Error('Email not confirmed'))).toMatch(/인증 메일/);
    expect(authErrorText(new Error('Invalid API key'))).toMatch(/공개 키/);
  });
});
