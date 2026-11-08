import Papa from 'papaparse';
import { z } from 'zod';
import { parseArea } from './area';

export const labels = {
  court: '법원',
  caseNumber: '사건번호',
  itemNumber: '물건번호',
  address: '주소',
  propertyType: '유형',
  area: '면적(㎡)',
  auctionDate: '매각기일',
  appraisal: '감정가',
  minimumPrice: '최저가',
  failedAuctions: '유찰 횟수',
  forecastDate: '예상 작성일',
  predictedPrice: '예상 낙찰가',
  virtualBid: '가상 입찰가',
  rationale: '판단 근거·특징',
  marketPrice: '예상 시세',
  extraCosts: '추가 비용 합계',
  targetProfit: '목표 이익',
  memoUrl: '상세 메모 링크',
  saleResult: '매각 결과',
  actualPrice: '실제 낙찰가',
  bidderCount: '입찰자 수',
  reviewNote: '복기 메모',
  sourceUrl: '출처 링크',
} as const;
export type FieldKey = keyof typeof labels;
export const moneyKeys: FieldKey[] = [
  'appraisal',
  'minimumPrice',
  'predictedPrice',
  'virtualBid',
  'marketPrice',
  'extraCosts',
  'targetProfit',
  'actualPrice',
];
export const resultKeys = ['saleResult', 'actualPrice', 'bidderCount', 'reviewNote'] as const;
export const saleResults = ['미확인', '낙찰', '유찰', '변경', '연기', '취하', '기각'] as const;
export const today = () =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
export function amount(value: unknown, label = '금액'): number | null {
  if (value == null || value === '') return null;
  const s = String(value)
    .trim()
    .replace(/^(?:KRW|[₩￦])\s*/i, '')
    .replace(/\s*(?:KRW|[₩￦])$/i, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '')
    .replace(/원$/, '');
  let total = NaN;
  if (/^\d+$/.test(s)) total = Number(s);
  else if (/^(?:\d+(?:\.\d+)?억)?(?:\d+(?:\.\d+)?만)?(?:\d+)?$/.test(s) && /[억만]/.test(s)) {
    total = 0;
    s.replace(/(\d+(?:\.\d+)?)(억|만)|([0-9]+)$/g, (_, n: string, u: string, tail: string) => {
      if (tail) total += Number(tail);
      else {
        const digits = u === '억' ? 8 : 4,
          [integer, f = ''] = n.split('.'),
          fraction = f.replace(/0+$/, '');
        total +=
          fraction.length > digits
            ? NaN
            : Number(integer) * 10 ** digits + Number((fraction + '00000000').slice(0, digits));
      }
      return '';
    });
  }
  if (!Number.isSafeInteger(total) || total < 0)
    throw new Error(label + '는 정수 원 단위로 입력하세요. 예: 1억 2300만원.');
  return total;
}
const date = z
  .string()
  .refine(
    (s) =>
      !s ||
      (/^\d{4}-\d{2}-\d{2}$/.test(s) &&
        Number.isFinite(new Date(s + 'T00:00:00Z').getTime()) &&
        new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s),
    '날짜를 확인하세요.',
  );
const text = z.string().trim().max(4000).default('');
const number = z.number().nonnegative().safe().nullable();
const url = text.refine((s) => {
  if (!s) return true;
  try {
    const u = new URL(s);
    return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password;
  } catch {
    return false;
  }
}, 'http 또는 https 링크만 입력하세요.');
export const journalSchema = z.object({
  court: text,
  caseNumber: text,
  itemNumber: text,
  address: text,
  propertyType: text,
  area: z.number().positive().nullable(),
  auctionDate: date,
  appraisal: number,
  minimumPrice: number,
  failedAuctions: number,
  forecastDate: date,
  predictedPrice: number,
  virtualBid: number,
  rationale: text,
  marketPrice: number,
  extraCosts: number,
  targetProfit: number,
  memoUrl: url,
  saleResult: z.enum(saleResults),
  actualPrice: number,
  bidderCount: number,
  reviewNote: text,
  sourceUrl: url,
  beforeResultConfirmed: z.boolean(),
});
export type Journal = z.infer<typeof journalSchema>;
export type Draft = Record<FieldKey, string> & { beforeResultConfirmed: boolean };
export interface AuctionRecord {
  id: string;
  owner_id: string;
  court: string;
  case_number: string;
  item_number: string;
  auction_date: string;
  fields: Journal;
  created_at: string;
  import_context?: unknown;
}
export interface Evidence {
  field: string;
  value: string | null;
  documentId: string | null;
  page: number | null;
  quote: string | null;
  needsReview: boolean;
}
export interface Tenant {
  occupant: string | null;
  unit: string | null;
  deposit: string | null;
  monthlyRent: string | null;
  moveInDate: string | null;
  fixedDate: string | null;
  distributionDemandDate: string | null;
  claim: string | null;
  documentId: string | null;
  page: number | null;
  quote: string | null;
  needsReview: boolean;
}
export interface TradeDraft {
  price: string | null;
  contractDate: string | null;
  floor: string | null;
  area: string | null;
  address: string | null;
  buildingName: string | null;
  cancelled: boolean | null;
  documentId: string | null;
  page: number | null;
  quote: string | null;
  needsReview: boolean;
}
export type AnalysisMode = 'auction' | 'tenancy' | 'transactions';
export interface Extraction {
  fields: Partial<Record<FieldKey, string | null>>;
  evidence: Evidence[];
  tenants: Tenant[];
  transactions: TradeDraft[];
  warnings: string[];
}
export interface Analysis {
  id: string;
  mode: AnalysisMode;
  result: Extraction;
  document_ids: string[];
  created_at: string;
}
export interface DocumentRow {
  id: string;
  record_id: string | null;
  owner_id: string;
  name: string;
  path: string;
  mime_type: string;
  size: number;
}
export interface Trade {
  id?: string;
  record_id: string;
  price: number;
  contract_date: string;
  floor: string | null;
  area: number | null;
  address: string | null;
  cancelled: boolean | null;
  source: unknown;
  reviewed: boolean;
}
export const emptyDraft = (): Draft =>
  ({
    ...Object.fromEntries(Object.keys(labels).map((k) => [k, ''])),
    saleResult: '미확인',
    forecastDate: today(),
    beforeResultConfirmed: false,
  }) as Draft;
export function normalize(input: Record<string, unknown>, required = true): Journal {
  const r: Record<string, unknown> = {};
  for (const key of Object.keys(labels)) r[key] = String(input[key] ?? '').trim();
  for (const key of moneyKeys) r[key] = amount(input[key], labels[key]);
  for (const key of ['failedAuctions', 'bidderCount']) {
    r[key] = amount(input[key], labels[key as FieldKey]);
    if (Number(r[key]) > 1000000) throw new Error('횟수·입찰자 수를 확인하세요.');
  }
  r.area = parseArea(input.area);
  r.saleResult = !r.saleResult || r.saleResult === 'UNKNOWN' ? '미확인' : r.saleResult;
  r.beforeResultConfirmed = input.beforeResultConfirmed === true;
  const result = journalSchema.parse(r);
  if (
    required &&
    !['court', 'caseNumber', 'itemNumber', 'auctionDate'].every((k) => result[k as FieldKey])
  )
    throw new Error('법원·사건번호·물건번호·매각기일을 입력하세요.');
  if (result.saleResult === '낙찰' && !(Number(result.actualPrice) > 0))
    throw new Error('실제 낙찰가를 입력하세요.');
  return result;
}
export function checkPrediction(
  r: Journal,
  extraction: Extraction | null,
  corrected = false,
  reason = '',
) {
  if (!r.beforeResultConfirmed) return;
  if (!r.forecastDate || r.forecastDate > today() || r.forecastDate > r.auctionDate)
    throw new Error('예상 작성일은 오늘과 매각기일 이후일 수 없습니다.');
  if (r.saleResult === '낙찰' || Number(r.actualPrice) > 0)
    throw new Error('이미 결과가 있는 기록은 사전 예측으로 저장할 수 없습니다.');
  if (
    extraction &&
    (extraction.fields.saleResult === '낙찰' || extraction.fields.actualPrice) &&
    (!corrected || !reason.trim())
  )
    throw new Error('결과 오독 확인과 수정 사유가 필요합니다.');
}
export function derive(r: Journal) {
  const upperLimit = [r.marketPrice, r.extraCosts, r.targetProfit].every((v) => v !== null)
    ? r.marketPrice! - r.extraCosts! - r.targetProfit!
    : null;
  const evaluable =
    r.beforeResultConfirmed &&
    !!r.forecastDate &&
    r.forecastDate <= today() &&
    r.forecastDate <= r.auctionDate &&
    r.saleResult === '낙찰' &&
    Number(r.predictedPrice) > 0 &&
    Number(r.actualPrice) > 0;
  const error = evaluable ? (r.predictedPrice! - r.actualPrice!) / r.actualPrice! : null;
  const compare = (value: number | null, base: number | null) =>
    value == null || base == null
      ? '미입력'
      : value < base
        ? '미만'
        : value === base
          ? '동액'
          : '초과';
  return {
    upperLimit,
    evaluable,
    error,
    absoluteError: error == null ? null : Math.abs(error),
    minimumComparison: compare(r.virtualBid, r.minimumPrice),
    actualComparison: r.saleResult === '낙찰' ? compare(r.virtualBid, r.actualPrice) : '결과 대기',
    limitComparison: compare(r.virtualBid, upperLimit),
  };
}
export const identity = (r: Journal) =>
  [r.court, r.caseNumber, r.itemNumber, r.auctionDate]
    .map((v) => v.replace(/\s+/g, '').toLowerCase())
    .join('|');
export function metrics(records: AuctionRecord[]) {
  const counts = new Map<string, number>();
  records.forEach((r) => counts.set(identity(r.fields), (counts.get(identity(r.fields)) || 0) + 1));
  const rows = records
      .filter((r) => counts.get(identity(r.fields)) === 1)
      .map((r) => derive(r.fields))
      .filter((r) => r.evaluable),
    n = rows.length,
    near = rows.filter((r) => r.absoluteError! <= 0.05).length;
  return {
    n,
    absolute: n ? rows.reduce((s, r) => s + r.absoluteError!, 0) / n : null,
    signed: n ? rows.reduce((s, r) => s + r.error!, 0) / n : null,
    near,
    ratio: n ? near / n : null,
  };
}
export function parseCsv(source: string) {
  const parsed = Papa.parse<string[]>(source.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy' });
  if (parsed.errors.length) throw new Error('CSV 형식을 확인하세요: ' + parsed.errors[0].message);
  const index = parsed.data.findIndex(
    (row) => row.includes('사건번호') && row.includes('매각기일'),
  );
  if (index < 0) throw new Error('마당 기록 탭의 CSV를 선택하세요.');
  const header = parsed.data[index];
  const records = parsed.data.slice(index + 1).map((row, i) => {
    const input: Record<string, unknown> = {};
    Object.entries(labels).forEach(
      ([key, label]) => (input[key] = row[header.indexOf(label)] || ''),
    );
    input.beforeResultConfirmed = /^(true|참)$/i.test(
      row[header.indexOf('결과 확인 전 예측')] || '',
    );
    try {
      return { fields: normalize(input), originalRow: row };
    } catch (e) {
      throw new Error(`CSV ${index + i + 2}행: ${errorText(e)}`);
    }
  });
  if (records.length > 500) throw new Error('한 번에 500행까지 가져올 수 있습니다.');
  return records;
}
export function exportCsv(records: AuctionRecord[]) {
  return (
    '\uFEFF' +
    Papa.unparse(
      {
        fields: [...Object.values(labels), '결과 확인 전 예측'],
        data: records.map((r) => [
          ...Object.keys(labels).map((k) => r.fields[k as FieldKey]),
          r.fields.beforeResultConfirmed,
        ]),
      },
      { escapeFormulae: true },
    )
  );
}
export const errorText = (error: unknown) =>
  error instanceof z.ZodError
    ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n')
    : error instanceof Error
      ? error.message
      : '작업을 완료하지 못했습니다.';
export const money = (value: number | null | undefined) =>
  value == null ? '—' : new Intl.NumberFormat('ko-KR').format(value) + '원';
export const pct = (value: number | null, signed = false) =>
  value == null ? '—' : (signed && value > 0 ? '+' : '') + (value * 100).toFixed(1) + '%';
export function areaGroup(tradeArea: number | null, targetArea: number | null) {
  return tradeArea == null
    ? '면적 미상'
    : targetArea == null
      ? '기준 면적 미상'
      : Math.abs(tradeArea - targetArea) < 0.005
        ? '동일 면적'
        : '다른 면적';
}
