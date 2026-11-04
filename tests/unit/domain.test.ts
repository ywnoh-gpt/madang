import { describe, it, expect } from 'vitest';
import {
  amount,
  areaGroup,
  checkPrediction,
  derive,
  exportCsv,
  metrics,
  normalize,
  parseCsv,
  type AuctionRecord,
  type Extraction,
} from '../../src/domain/journal';
import { simulate, simulationDefaults } from '../../src/domain/simulator';
import { emptyTrade, reviewTrade } from '../../src/domain/trades';
const base = normalize({
  court: '서울중앙지방법원',
  caseNumber: '2026타경123',
  itemNumber: '1',
  auctionDate: '2026-09-20',
  forecastDate: '2026-09-01',
  predictedPrice: 105000000,
  virtualBid: 100000000,
  minimumPrice: 90000000,
  marketPrice: 150000000,
  extraCosts: 10000000,
  targetProfit: 20000000,
  beforeResultConfirmed: true,
});
describe('journal', () => {
  it('keeps signed/absolute five percent and ties distinct', () => {
    const fields = { ...base, saleResult: '낙찰' as const, actualPrice: 100000000 };
    expect(derive(fields)).toMatchObject({
      upperLimit: 120000000,
      error: 0.05,
      absoluteError: 0.05,
      actualComparison: '동액',
    });
    expect(metrics([{ id: '1', fields } as AuctionRecord])).toMatchObject({
      n: 1,
      near: 1,
      ratio: 1,
    });
    expect(
      metrics([
        { id: '1', fields },
        { id: '2', fields },
      ] as AuctionRecord[]).n,
    ).toBe(0);
  });
  it('excludes hindsight and unknown outcomes', () => {
    expect(
      derive({ ...base, saleResult: '낙찰', actualPrice: 100000000, beforeResultConfirmed: false })
        .evaluable,
    ).toBe(false);
    expect(derive(base).error).toBeNull();
    expect(() => checkPrediction({ ...base, forecastDate: '2099-01-01' }, null)).toThrow();
    const extraction = { fields: { actualPrice: '1억원' } } as Extraction;
    expect(() => checkPrediction(base, extraction)).toThrow(/수정 사유/);
    expect(() => checkPrediction(base, extraction, true, '최저가를 오독')).not.toThrow();
  });
  it('parses exact won units and rejects fractional/range/currency guessing', () => {
    expect(amount('KRW 1억 2300만원')).toBe(123000000);
    expect(amount('0.00000001억')).toBe(1);
    for (const s of ['USD 100', '1~2억', '-1', '1.1원', '1.00001만'])
      expect(() => amount(s)).toThrow();
    expect(() => normalize({ ...base, auctionDate: '2026-02-30' })).toThrow();
  });
  it('migrates the old two-header CSV and escapes formula cells', () => {
    const csv =
      'madang-journal-v1,,,,,,,,\n법원,사건번호,물건번호,매각기일,예상 작성일,예상 낙찰가,매각 결과,실제 낙찰가,결과 확인 전 예측\n서울중앙지방법원,2026타경123,1,2026-09-20,2026-09-01,105000000,낙찰,100000000,TRUE';
    const rows = parseCsv(csv);
    expect(rows[0].fields.beforeResultConfirmed).toBe(true);
    const out = exportCsv([
      { fields: { ...base, rationale: '=HYPERLINK("test")' } } as AuctionRecord,
    ]);
    expect(out).toContain("'=HYPERLINK");
    expect(parseCsv(out)[0].fields.predictedPrice).toBe(105000000);
  });
});
describe('real trades', () => {
  it('keeps different areas, unknown areas and cancellation states separate', () => {
    expect(areaGroup(59.9, 84)).toBe('다른 면적');
    expect(areaGroup(84, 84)).toBe('동일 면적');
    expect(areaGroup(null, 84)).toBe('면적 미상');
    const row = reviewTrade(
      { ...emptyTrade(), price: '2억', contractDate: '2026-10-20', area: '59.9', floor: '지하1' },
      'record',
    );
    expect(row).toMatchObject({ price: 200000000, area: 59.9, cancelled: null, floor: '지하1' });
    expect(() =>
      reviewTrade({ ...emptyTrade(), price: '2억', contractDate: '2026-02-30' }, 'record'),
    ).toThrow();
  });
});
describe('corporate simulator', () => {
  it('separates operating expenses and capitalized costs without counting either twice', () => {
    const r = simulate({
      ...simulationDefaults,
      bid: 100000000,
      sale: 160000000,
      operating: 10000000,
      capital: 20000000,
      corporateRate: 10,
      housingAdditionalRate: 20,
    });
    expect(r.costBasis).toBe(120000000);
    expect(r.propertyGain).toBe(40000000);
    expect(r.taxableProfit).toBe(30000000);
    expect(r.generalCorporate).toBe(3000000);
    expect(r.housingAdditional).toBe(8000000);
    expect(r.netProfit).toBe(19000000);
  });
  it('handles VAT-inclusive prices, building share and input-credit cash flows', () => {
    const r = simulate({
      ...simulationDefaults,
      type: 'businessOffice',
      bid: 110000000,
      sale: 165000000,
      buildingShare: 100,
      purchaseVatRate: 10,
      saleVatRate: 10,
      inputCreditRate: 100,
      housingAdditionalRate: 20,
      corporateRate: 10,
    });
    expect(r.purchaseNet).toBe(100000000);
    expect(r.purchaseVat).toBe(10000000);
    expect(r.saleVat).toBe(15000000);
    expect(r.vatSettlement).toBe(5000000);
    expect(r.housingAdditional).toBe(0);
    expect(r.netProfit).toBe(45000000);
  });
  it('capitalizes unrecoverable VAT, respects losses and shows refund assumptions', () => {
    const i = {
      ...simulationDefaults,
      bid: 110000000,
      sale: 90000000,
      buildingShare: 100,
      purchaseVatRate: 10,
      inputCreditRate: 0,
      corporateRate: 10,
    };
    expect(simulate(i)).toMatchObject({
      nonRecoverableVat: 10000000,
      costBasis: 110000000,
      generalCorporate: 0,
      netProfit: -20000000,
    });
    expect(simulate({ ...i, inputCreditRate: 100 }).vatSettlement).toBe(-10000000);
    expect(() => simulate({ ...i, corporateRate: 101 })).toThrow();
  });
});
