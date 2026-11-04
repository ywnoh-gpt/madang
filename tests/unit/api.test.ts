import { afterEach, describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHandler, productionDependencies } from '../../server/analyze';
import { assertFile, validateExtraction } from '../../server/extraction';
const user = '11111111-1111-4111-8111-111111111111',
  doc = '22222222-2222-4222-8222-222222222222',
  bytes = Buffer.from('%PDF-1.4\nsynthetic only');
const raw = {
  fields: { court: '서울중앙지방법원', predictedPrice: 'FORBIDDEN' },
  evidence: [],
  tenants: [],
  transactions: [],
  warnings: [],
};
function fixture(
  options: {
    auth?: boolean;
    allowed?: boolean;
    missing?: boolean;
    raw?: unknown;
    saveError?: boolean;
  } = {},
) {
  const ownerFilter = vi
    .fn()
    .mockResolvedValue({
      data: options.missing
        ? []
        : [
            {
              id: doc,
              owner_id: user,
              name: 'fixture.pdf',
              path: `${user}/${doc}/original`,
              mime_type: 'application/pdf',
              size: bytes.length,
            },
          ],
      error: null,
    });
  const download = vi.fn().mockResolvedValue({ data: new Blob([bytes]), error: null }),
    generate = vi
      .fn()
      .mockResolvedValue({ raw: options.raw || raw, model: 'gemini-flash-lite-latest' });
  const client = {
    auth: {
      getUser: vi
        .fn()
        .mockResolvedValue({
          data: { user: options.auth === false ? null : { id: user } },
          error: null,
        }),
    },
    from: vi.fn((table: string) =>
      table === 'documents'
        ? { select: () => ({ in: () => ({ eq: ownerFilter }) }) }
        : {
            insert: () => ({
              select: () => ({
                single: async () => ({
                  data: options.saveError ? null : { id: 'analysis', result: raw },
                  error: options.saveError ? { message: 'test error' } : null,
                }),
              }),
            }),
          },
    ),
    rpc: vi.fn().mockResolvedValue({ data: options.allowed !== false, error: null }),
    storage: { from: () => ({ download }) },
  };
  const handler = createHandler({ client: () => client as unknown as SupabaseClient, generate });
  const headers: Record<string, unknown> = {},
    response = {
      statusCode: 0,
      body: null as unknown,
      setHeader: (key: string, value: unknown) => {
        headers[key] = value;
      },
      status(n: number) {
        this.statusCode = n;
        return this;
      },
      json(body: unknown) {
        this.body = body;
        return this;
      },
    };
  const request = {
    method: 'POST',
    headers: { authorization: 'Bearer synthetic.jwt.token' },
    body: { mode: 'auction', documentIds: [doc] },
  } as VercelRequest;
  return {
    handler,
    client,
    generate,
    ownerFilter,
    download,
    response,
    request,
    run: async () => {
      await handler(request, response as unknown as VercelResponse);
      return response;
    },
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe('server authorization and extraction route', () => {
  it('verifies login and owner-scoped original files before making one generation request', async () => {
    const f = fixture();
    const res = await f.run();
    expect(res.statusCode).toBe(200);
    expect(f.ownerFilter).toHaveBeenCalledWith('owner_id', user);
    expect(f.generate).toHaveBeenCalledTimes(1);
    expect(f.generate.mock.calls[0][1][0].bytes).toEqual(new Uint8Array(bytes));
  });
  it('rejects unauthenticated, unknown documents and quota exhaustion before paid calls', async () => {
    for (const [option, status] of [
      [{ auth: false }, 401],
      [{ missing: true }, 404],
      [{ allowed: false }, 429],
    ] as const) {
      const f = fixture(option);
      expect((await f.run()).statusCode).toBe(status);
      expect(f.generate).not.toHaveBeenCalled();
      expect(f.download).not.toHaveBeenCalled();
    }
  });
  it('rejects arbitrary URLs, duplicate file IDs and unsupported methods', async () => {
    const f = fixture();
    f.request.body = { mode: 'auction', documentIds: [doc], url: 'https://example.com' };
    expect((await f.run()).statusCode).toBe(400);
    f.request.body = { mode: 'auction', documentIds: [doc, doc] };
    expect((await f.run()).statusCode).toBe(400);
    f.request.method = 'GET';
    expect((await f.run()).statusCode).toBe(405);
    expect(f.generate).not.toHaveBeenCalled();
  });
  it('does not report success if analysis storage fails after generation', async () => {
    const f = fixture({ saveError: true });
    expect((await f.run()).statusCode).toBe(502);
    expect(JSON.stringify(f.response.body)).toContain('저장에 실패');
    expect(f.generate).toHaveBeenCalledTimes(1);
  });
  it('strips forecast hallucinations and forces review on tenancy or missing evidence', () => {
    const result = validateExtraction(raw, [doc]);
    expect(result.fields).not.toHaveProperty('predictedPrice');
    const tenant = {
      occupant: '갑',
      unit: null,
      deposit: null,
      monthlyRent: null,
      moveInDate: null,
      fixedDate: null,
      distributionDemandDate: null,
      claim: null,
      documentId: doc,
      page: 1,
      quote: null,
      needsReview: false,
    };
    const parsed = validateExtraction({ ...raw, tenants: [tenant] }, [doc]);
    expect(parsed.tenants[0].needsReview).toBe(true);
    expect(parsed.warnings).not.toHaveLength(0);
    expect(() =>
      validateExtraction({ ...raw, tenants: [{ ...tenant, documentId: user }] }, [doc]),
    ).toThrow(/출처/);
  });
  it('validates magic bytes instead of trusting PDF/image MIME labels', () => {
    expect(() => assertFile(new Uint8Array(bytes), 'application/pdf')).not.toThrow();
    expect(() => assertFile(new Uint8Array(Buffer.from('<html>')), 'application/pdf')).toThrow();
    expect(() => assertFile(new Uint8Array(bytes), 'text/html')).toThrow();
  });
});
describe('actual server transport with intercepted Google responses', () => {
  it('keeps keys out of URLs, makes one request, redacts 503 and does not auto-retry', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'synthetic-never-commit-real-key');
    vi.stubEnv('GEMINI_MODEL', 'gemini-flash-lite-latest');
    const fetch = vi
      .fn()
      .mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({
          error: { message: 'busy synthetic-never-commit-real-key https://example.com/private' },
        }),
      });
    vi.stubGlobal('fetch', fetch);
    await expect(
      productionDependencies.generate('auction', [
        { id: doc, name: 'test.pdf', mime: 'application/pdf', bytes },
      ]),
    ).rejects.toMatchObject({ status: 503 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).not.toContain('key=');
    expect(fetch.mock.calls[0][1].headers['x-goog-api-key']).toBe(
      'synthetic-never-commit-real-key',
    );
    try {
      await productionDependencies.generate('auction', []);
    } catch (e) {
      expect((e as Error).message).not.toContain('synthetic-never-commit-real-key');
      expect((e as Error).message).not.toContain('https://example.com');
    }
  });
  it('rejects specialty models without calling Google', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'synthetic-key');
    vi.stubEnv('GEMINI_MODEL', 'gemini-2.5-flash-preview-tts');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await expect(productionDependencies.generate('auction', [])).rejects.toMatchObject({
      status: 503,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
