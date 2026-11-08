import { describe, expect, it } from 'vitest';
import { parseArea } from '../../src/domain/area';
import { normalize, parseCsv } from '../../src/domain/journal';
import { emptyTrade, reviewTrade } from '../../src/domain/trades';

describe('square metre inputs and OCR text', () => {
  it.each([
    '59.9',
    '59.9㎡',
    '59.9 ㎡',
    '59.9m²',
    '59.9 m2',
    '59.9 m^2',
    '59.9 제곱미터',
    '５９．９㎡',
    '전용면적: 59.9㎡',
    '건물 면적 59.9㎡',
  ])('accepts explicit square metres: %s', (value) => expect(parseArea(value)).toBe(59.9));
  it('accepts the reported building-area string without altering its amount', () => {
    expect(parseArea('건물 48.72㎡')).toBe(48.72);
    expect(parseArea('건물면적：48.72 m²')).toBe(48.72);
    expect(() => parseArea('건물 48.72㎡ / 토지 20㎡')).toThrow(/면적을 확인/);
  });
  it('keeps numeric precision and valid thousands separators', () => {
    expect(parseArea(59.90123)).toBe(59.90123);
    expect(parseArea('59.90123㎡')).toBe(59.90123);
    expect(parseArea('1,234.56㎡')).toBe(1234.56);
  });
  it.each([null, undefined, '', '   ', '미상', '미확인', 'UNKNOWN', 'N/A', '-', '—'])(
    'keeps missing area empty: %s',
    (value) => expect(parseArea(value)).toBeNull(),
  );
  it.each([
    '59.9/84㎡',
    '59~60㎡',
    '59.9㎡, 84㎡',
    '전용59.9 공급84',
    '18평',
    '59,9',
    '5 9.9㎡',
    '㎡',
    '0',
    '-1',
    NaN,
    Infinity,
    true,
    {},
    '59.9e2',
    '59.9abc',
  ])('rejects ambiguous or invalid input with an actionable message: %s', (value) => {
    expect(() => parseArea(value)).toThrow(/면적을 확인/);
    expect(() => parseArea(value)).not.toThrow(/NaN|Invalid input/);
  });
  it('normalizes the journal, old CSV and trades with the same rules', () => {
    const fields = {
      court: '서울중앙지방법원',
      caseNumber: '2026타경AREA',
      itemNumber: '1',
      auctionDate: '2026-10-01',
      area: '59.9㎡',
    };
    expect(normalize(fields).area).toBe(59.9);
    expect(normalize({ ...fields, area: '미상' }).area).toBeNull();
    const csv =
      '법원,사건번호,물건번호,매각기일,면적(㎡)\n서울중앙지방법원,2026타경AREA,1,2026-10-01,59.9㎡';
    expect(parseCsv(csv)[0].fields.area).toBe(59.9);
    const raw = { ...emptyTrade(), price: '2억', contractDate: '2026-10-01', area: '59.9 m²' };
    const trade = reviewTrade(raw, 'record');
    expect(trade.area).toBe(59.9);
    expect(trade.source).toBe(raw);
  });
});
