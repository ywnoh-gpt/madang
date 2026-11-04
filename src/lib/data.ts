import { createClient } from '@supabase/supabase-js';
import {
  normalize,
  type AuctionRecord,
  type Analysis,
  type AnalysisMode,
  type DocumentRow,
  type Journal,
  type Trade,
} from '../domain/journal';
import type { SimulationInput } from '../domain/simulator';
import { simulate } from '../domain/simulator';
const url = import.meta.env.VITE_SUPABASE_URL,
  key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabase = url && key && !url.includes('YOUR_PROJECT') ? createClient(url, key) : null;
export function db() {
  if (!supabase) throw new Error('Supabase 환경변수를 먼저 설정하세요.');
  return supabase;
}
function check(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}
export async function records() {
  let result: AuctionRecord[] = [];
  for (let offset = 0; ; offset += 250) {
    const { data, error } = await db()
      .from('auction_records')
      .select('*')
      .order('created_at', { ascending: false })
      .order('id')
      .range(offset, offset + 249);
    check(error);
    result = result.concat((data || []).map((row) => ({ ...row, fields: normalize(row.fields) })));
    if ((data || []).length < 250) break;
  }
  return result;
}
export async function upload(files: File[], recordId?: string): Promise<DocumentRow[]> {
  const { data: auth } = await db().auth.getUser();
  if (!auth.user) throw new Error('로그인 후 자료를 올려 주세요.');
  if (files.length > 3 || files.reduce((s, f) => s + f.size, 0) > 12 * 1024 * 1024)
    throw new Error('자료는 최대 3개, 합계 12MB까지 지원합니다.');
  const completed: DocumentRow[] = [];
  try {
    for (const file of files) {
      if (
        !['image/png', 'image/jpeg', 'image/webp', 'application/pdf'].includes(file.type) ||
        file.size === 0 ||
        file.size > (file.type === 'application/pdf' ? 8 : 5) * 1024 * 1024
      )
        throw new Error('이미지 5MB·PDF 8MB까지 올릴 수 있습니다.');
      const id = crypto.randomUUID(),
        path = `${auth.user.id}/${id}/original`;
      const row: DocumentRow = {
        id,
        owner_id: auth.user.id,
        record_id: null,
        name: file.name,
        path,
        mime_type: file.type,
        size: file.size,
      };
      const { error: rowError } = await db().from('documents').insert(row);
      check(rowError);
      const { error } = await db()
        .storage.from('auction-documents')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) {
        await db().from('documents').delete().eq('id', id);
        throw new Error(error.message);
      }
      completed.push(row);
    }
    if (recordId && completed.length) {
      const { data: linked, error } = await db()
        .from('documents')
        .update({ record_id: recordId })
        .in(
          'id',
          completed.map((d) => d.id),
        )
        .select('id');
      check(error);
      if (linked?.length !== completed.length)
        throw new Error('원본 연결을 확인하지 못했습니다. 물건 상세에서 보관 원본을 확인하세요.');
      completed.forEach((d) => {
        d.record_id = recordId;
      });
    }
    return completed;
  } catch (error) {
    // Linked documents stay available; only unlinked draft uploads are removable by policy.
    for (const doc of completed) {
      // RLS protects any source already linked by a successful server write.
      const { error: removeError } = await db()
        .storage.from('auction-documents')
        .remove([doc.path]);
      if (!removeError) await db().from('documents').delete().eq('id', doc.id);
    }
    throw error;
  }
}
export async function analyze(mode: AnalysisMode, documents: DocumentRow[]): Promise<Analysis> {
  const { data } = await db().auth.getSession();
  if (!data.session) throw new Error('로그인이 필요합니다.');
  const response = await fetch('/api/analyze', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + data.session.access_token,
    },
    body: JSON.stringify({ mode, documentIds: documents.map((d) => d.id) }),
    signal: AbortSignal.timeout(55000),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(
      response.status === 404
        ? '분석 API를 찾지 못했습니다. Vercel 배포 주소를 확인하세요.'
        : '분석 서버 응답을 읽지 못했습니다. 입력과 원본은 유지됩니다.',
    );
  }
  if (!response.ok) throw new Error(body.error || '분석 요청에 실패했습니다.');
  return body.analysis;
}
export async function saveRecord(
  fields: Journal,
  documents: DocumentRow[],
  analyses: Analysis[],
  review: { reviewed: boolean; resultCorrected: boolean; reason: string },
) {
  const { data, error } = await db().rpc('create_auction_record', {
    payload: fields,
    p_document_ids: documents.map((d) => d.id),
    p_analysis_ids: analyses.map((a) => a.id),
    p_review_context: review,
  });
  check(error);
  return data as AuctionRecord;
}
export async function updateResult(record: AuctionRecord, patch: Partial<Journal>) {
  const fields = normalize({ ...record.fields, ...patch });
  const { error } = await db().from('auction_records').update({ fields }).eq('id', record.id);
  check(error);
}
export async function detail(id: string) {
  const queries = await Promise.all([
    db().from('documents').select('*').eq('record_id', id),
    db().from('record_analyses').select('analysis_id').eq('record_id', id),
    db()
      .from('transactions')
      .select('*')
      .eq('record_id', id)
      .order('contract_date', { ascending: false }),
    db()
      .from('simulations')
      .select('*')
      .eq('record_id', id)
      .order('created_at', { ascending: false }),
    db().from('record_history').select('*').eq('record_id', id).order('created_at'),
    db()
      .from('analysis_reviews')
      .select('*')
      .eq('record_id', id)
      .order('created_at', { ascending: false }),
  ]);
  queries.forEach((q) => check(q.error));
  const ids = queries[1].data?.map((a) => a.analysis_id) || [];
  const analyses = ids.length
    ? await db().from('analyses').select('*').in('id', ids)
    : { data: [], error: null };
  check(analyses.error);
  return {
    documents: queries[0].data as DocumentRow[],
    analyses: analyses.data as Analysis[],
    trades: queries[2].data as Trade[],
    simulations: queries[3].data || [],
    history: queries[4].data || [],
    reviews: queries[5].data || [],
  };
}
export type Detail = Awaited<ReturnType<typeof detail>>;
export async function linkAnalysis(recordId: string, analysis: Analysis) {
  const { error } = await db()
    .from('record_analyses')
    .insert({ record_id: recordId, analysis_id: analysis.id });
  check(error);
}
export async function signedUrl(doc: DocumentRow) {
  const { data, error } = await db()
    .storage.from('auction-documents')
    .createSignedUrl(doc.path, 120);
  check(error);
  return data!.signedUrl;
}
export async function saveTrades(trades: Trade[]) {
  const { error } = await db().from('transactions').insert(trades);
  check(error);
}
export async function saveReview(
  recordId: string,
  analysisId: string,
  value: unknown,
  reason: string,
) {
  const { error } = await db()
    .from('analysis_reviews')
    .insert({ record_id: recordId, analysis_id: analysisId, reviewed_value: value, reason });
  check(error);
}
export async function saveSimulation(recordId: string, input: SimulationInput, name: string) {
  const output = simulate(input);
  if (!input.assumptionsConfirmed) throw new Error('세율·비용 가정 확인이 필요합니다.');
  const { error } = await db()
    .from('simulations')
    .insert({ record_id: recordId, name, version: output.version, input, output });
  check(error);
}
export async function importRecords(items: unknown) {
  const { data, error } = await db().rpc('import_auction_records', { items });
  check(error);
  return data as { inserted: number; skipped: number };
}
export async function backup() {
  const tables = [
    'auction_records',
    'documents',
    'analyses',
    'record_analyses',
    'transactions',
    'simulations',
    'analysis_reviews',
    'record_history',
  ] as const;
  const output: Record<string, unknown> = {
    format: 'madang-supabase-backup-v1',
    exportedAt: new Date().toISOString(),
  };
  for (const table of tables) {
    const rows: unknown[] = [];
    for (let offset = 0; ; offset += 250) {
      const { data, error } = await db()
        .from(table)
        .select('*')
        .order(table === 'record_analyses' ? 'analysis_id' : 'id')
        .range(offset, offset + 249);
      check(error);
      rows.push(...(data || []));
      if ((data || []).length < 250) break;
    }
    output[table] = rows;
  }
  return output;
}
