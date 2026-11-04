import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { z } from 'zod';
import { assertFile, prompt, responseSchema, validateExtraction } from './extraction.js';
const requestSchema = z
  .object({
    mode: z.enum(['auction', 'tenancy', 'transactions']),
    documentIds: z.array(z.string().uuid()).min(1).max(3),
  })
  .strict();
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export interface Dependencies {
  client: (token: string) => SupabaseClient;
  generate: (
    mode: 'auction' | 'tenancy' | 'transactions',
    docs: { id: string; name: string; mime: string; bytes: Uint8Array }[],
  ) => Promise<{ raw: unknown; model: string }>;
}
export function createHandler(deps: Dependencies) {
  return async (req: VercelRequest, res: VercelResponse) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        throw new ApiError(405, 'POST 요청만 지원합니다.');
      }
      const authorization = req.headers.authorization;
      if (typeof authorization !== 'string' || !/^Bearer [A-Za-z0-9._-]+$/.test(authorization))
        throw new ApiError(401, '로그인이 필요합니다.');
      const client = deps.client(authorization.slice(7)),
        { data: auth, error: authError } = await client.auth.getUser(authorization.slice(7));
      if (authError || !auth.user)
        throw new ApiError(401, '로그인이 만료됐습니다. 다시 로그인하세요.');
      if (Number(req.headers['content-length'] || 0) > 16384)
        throw new ApiError(413, '분석 요청에는 파일 ID만 보내세요.');
      let body: unknown;
      try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      } catch {
        throw new ApiError(400, '요청 JSON을 확인하세요.');
      }
      const parsed = requestSchema.safeParse(body);
      if (!parsed.success) throw new ApiError(400, '분석 유형과 원본 파일 ID를 확인하세요.');
      const { mode, documentIds } = parsed.data;
      if (new Set(documentIds).size !== documentIds.length)
        throw new ApiError(400, '같은 파일을 중복 요청할 수 없습니다.');
      const { data: documents, error: readError } = await client
        .from('documents')
        .select('id,name,path,mime_type,size,owner_id')
        .in('id', documentIds)
        .eq('owner_id', auth.user.id);
      if (readError || !documents || documents.length !== documentIds.length)
        throw new ApiError(404, '요청한 원본을 찾을 수 없습니다. 본인 자료인지 확인하세요.');
      if (documents.reduce((s, d) => s + Number(d.size), 0) > 12 * 1024 * 1024)
        throw new ApiError(413, '원본 전체 크기는 12MB 이하여야 합니다.');
      const { data: allowed, error: limitError } = await client.rpc('claim_analysis_request');
      if (limitError)
        throw new ApiError(503, '분석 사용량을 확인하지 못했습니다. DB 설정을 확인하세요.');
      if (allowed !== true) {
        res.setHeader('Retry-After', '300');
        throw new ApiError(429, '5분에 최대 5회 분석할 수 있습니다. 잠시 후 다시 시도하세요.');
      }
      const docs = [];
      for (const doc of documents) {
        const { data: file, error } = await client.storage
          .from('auction-documents')
          .download(doc.path);
        if (error || !file)
          throw new ApiError(
            502,
            '원본 다운로드에 실패했습니다. 원본 파일을 유지한 채 다시 확인하세요.',
          );
        const bytes = new Uint8Array(await file.arrayBuffer());
        try {
          assertFile(bytes, doc.mime_type);
        } catch {
          throw new ApiError(400, '원본 자료의 형식·크기를 확인하세요.');
        }
        if (bytes.length !== doc.size)
          throw new ApiError(400, '원본 자료의 크기가 저장된 정보와 다릅니다.');
        docs.push({ id: doc.id, name: doc.name, mime: doc.mime_type, bytes });
      }
      const generated = await deps.generate(mode, docs);
      let result;
      try {
        result = validateExtraction(generated.raw, documentIds);
      } catch {
        throw new ApiError(
          502,
          'AI 응답의 형식·원문 근거를 검증하지 못했습니다. 원본을 확인하세요.',
        );
      }
      const { data: analysis, error: saveError } = await client
        .from('analyses')
        .insert({ mode, document_ids: documentIds, model: generated.model, result })
        .select()
        .single();
      if (saveError || !analysis)
        throw new ApiError(
          502,
          'AI 응답은 받았으나 분석 저장에 실패했습니다. 원본은 유지됩니다. 중복 분석 전에 DB 상태를 확인하세요.',
        );
      res.status(200).json({ analysis });
    } catch (error) {
      const safe =
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              '분석을 완료하지 못했습니다. 서버 환경변수와 연결 상태를 확인하세요.',
            );
      res.status(safe.status).json({ error: safe.message });
    }
  };
}
export const productionDependencies: Dependencies = {
  client(token) {
    const url = process.env.SUPABASE_URL,
      key = process.env.SUPABASE_ANON_KEY;
    if (!url || !key) throw new ApiError(503, '서버 Supabase 설정이 필요합니다.');
    return createClient(url, key, {
      global: { headers: { Authorization: 'Bearer ' + token } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  },
  async generate(mode, docs) {
    const key = process.env.GEMINI_API_KEY,
      model = process.env.GEMINI_MODEL || 'gemini-flash-lite-latest';
    if (!key) throw new ApiError(503, '서버에 Gemini API 키를 설정해야 합니다.');
    if (
      !/^gemini-(?:\d+(?:\.\d+)?-)?(?:flash(?:-lite)?|pro)(?:-[a-z0-9.-]+)?$/i.test(model) ||
      /tts|audio|image|live|computer|thinking|robotics|research/i.test(model)
    )
      throw new ApiError(503, '서버 인식 모델을 문서용 Gemini 모델로 설정하세요.');
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          signal: controller.signal,
          redirect: 'error',
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: prompt(mode) }] },
            contents: [
              {
                role: 'user',
                parts: docs.flatMap((d) => [
                  { text: `documentId: ${d.id}\n파일명: ${d.name}` },
                  {
                    inlineData: { mimeType: d.mime, data: Buffer.from(d.bytes).toString('base64') },
                  },
                ]),
              },
            ],
            generationConfig: {
              temperature: 0,
              maxOutputTokens: 16000,
              responseMimeType: 'application/json',
              responseSchema,
            },
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        const detail = String(data.error?.message || '')
          .split(key)
          .join('[키 숨김]')
          .replace(/https?:\/\/[^\s]+/g, '[URL 숨김]')
          .slice(0, 500);
        throw new ApiError(
          [400, 401, 403, 404, 429, 503].includes(response.status) ? response.status : 502,
          `Gemini HTTP ${response.status} · ${model}: ${detail} 자동 재시도하지 않았습니다.`,
        );
      }
      const candidate = data.candidates?.[0];
      if (candidate?.finishReason !== 'STOP')
        throw new ApiError(502, 'AI 응답이 중단되거나 차단되었습니다. 입력과 원본은 유지됩니다.');
      const rawText = candidate.content?.parts
        ?.filter((p: { text?: string; thought?: boolean }) => p.text && !p.thought)
        .map((p: { text: string }) => p.text)
        .join('');
      try {
        return { model, raw: JSON.parse(rawText) };
      } catch {
        throw new ApiError(502, 'AI 응답이 올바른 JSON이 아닙니다.');
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (controller.signal.aborted)
        throw new ApiError(
          504,
          'AI 응답 대기 시간이 초과됐습니다. Google의 처리가 계속될 수 있으니 중복 요청하지 마세요.',
        );
      throw new ApiError(502, '서버에서 Gemini에 연결하지 못했습니다. 입력과 원본은 유지됩니다.');
    } finally {
      clearTimeout(timer);
    }
  },
};
