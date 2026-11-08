import { describe, expect, it } from 'vitest';
import { validateExtraction, prompt } from '../../server/extraction';
const id = '11111111-1111-4111-8111-111111111111';
const base = '경기도 가상시 예시동 123-45';
const full = base + ' 예시타운 2층203호';
function evidence(value: string, quote = value, field = 'addressTitle') {
  return { field, value, quote, documentId: id, page: 1, needsReview: false };
}
function raw(address: string | null = base, items: ReturnType<typeof evidence>[] = []) {
  return {
    fields: { address, propertyType: '도시형생활주택' },
    evidence: items,
    tenants: [],
    transactions: [],
    warnings: [],
  };
}
describe('grounded full property addresses', () => {
  it('preserves the full title including building, floor and unit instead of the short copy line', () => {
    const result = validateExtraction(
      raw(base, [evidence(base, base, 'addressBase'), evidence(full)]),
      [id],
    );
    expect(result.fields.address).toBe(full);
    expect(result.evidence.find((e) => e.field === 'address')?.quote).toBe(full);
    expect(result.evidence.find((e) => e.field === 'addressBase')?.value).toBe(base);
  });
  it('never shortens a full address when the map has only a parcel', () => {
    expect(
      validateExtraction(raw(full, [evidence(base, base, 'address')]), [id]).fields.address,
    ).toBe(full);
  });
  it('requires the longer value to appear in its quoted source', () => {
    const result = validateExtraction(raw(base, [evidence(full, base)]), [id]);
    expect(result.fields.address).toBe(base);
    expect(result.warnings.join()).toMatch(/호수/);
    expect(result.evidence[0].needsReview).toBe(true);
  });
  it('does not infer a missing unit or fill an intentionally unknown address', () => {
    expect(validateExtraction(raw(base, []), [id]).fields.address).toBe(base);
    expect(validateExtraction(raw(null, [evidence(full)]), [id]).fields.address).toBeNull();
  });
  it('does not mistake a longer parcel number for a longer address of the same property', () => {
    expect(
      validateExtraction(raw(base, [evidence(base + '1 예시타운 2층203호')]), [id]).fields.address,
    ).toBe(base);
    expect(
      validateExtraction(raw(base, [evidence(base + '-1 예시타운 2층203호')]), [id]).fields.address,
    ).toBe(base);
  });
  it('does not choose between contradictory unit numbers', () => {
    const result = validateExtraction(
      raw(base, [evidence(full), evidence(base + ' 예시타운 3층303호')]),
      [id],
    );
    expect(result.fields.address).toBe(base);
    expect(result.warnings.join()).toMatch(/서로 다릅니다/);
  });
  it('does not choose a unit from a source quoting several units', () => {
    const result = validateExtraction(raw(base, [evidence(full, full + ' 및 204호')]), [id]);
    expect(result.fields.address).toBe(base);
    expect(result.evidence[0].needsReview).toBe(true);
  });
  it('does not take a road sign or unrelated map location as address details', () => {
    expect(
      validateExtraction(raw(base, [evidence('가상로 71-3 예시빌딩 203호')]), [id]).fields.address,
    ).toBe(base);
  });
  it('does not trust a missing or wrong source document', () => {
    const missing = { ...evidence(full), documentId: null };
    expect(validateExtraction({ ...raw(), evidence: [missing] }, [id]).fields.address).toBe(base);
    expect(() =>
      validateExtraction(
        raw(base, [{ ...evidence(full), documentId: '22222222-2222-4222-8222-222222222222' }]),
        [id],
      ),
    ).toThrow(/출처/);
  });
  it('handles source whitespace and preserves existing floor information', () => {
    const result = validateExtraction(
      raw(base + ' 예시타운 2층', [evidence(base + ' 예시타운 2층 203호')]),
      [id],
    );
    expect(result.fields.address).toBe(base + ' 예시타운 2층 203호');
  });
  it('does not apply auction-title completion to tenancy or sales records', () => {
    for (const mode of ['tenancy', 'transactions'] as const)
      expect(validateExtraction(raw(base, [evidence(full)]), [id], mode).fields.address).toBe(base);
  });
  it('instructs extraction to read title details and avoid mixing photo signs or invented units', () => {
    expect(prompt('auction')).toMatch(/addressTitle/);
    expect(prompt('auction')).toMatch(/건물명·동·층·호수/);
    expect(prompt('auction')).toMatch(/도로명판/);
    expect(prompt('auction')).toMatch(/추측하지/);
  });
});
