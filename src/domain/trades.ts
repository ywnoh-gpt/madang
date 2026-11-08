import { amount, type Trade, type TradeDraft } from './journal';
import { parseArea } from './area';
export function reviewTrade(row: TradeDraft, recordId: string): Trade {
  const price = amount(row.price, '거래금액');
  if (!price || price <= 0) throw new Error('거래금액을 확인하세요.');
  const date = row.contractDate || '',
    parsed = new Date(date + 'T00:00:00Z');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  )
    throw new Error('계약일을 YYYY-MM-DD로 확인하세요.');
  const area = parseArea(row.area);
  return {
    record_id: recordId,
    price,
    contract_date: date,
    floor: row.floor || null,
    area,
    address: row.address || null,
    cancelled: row.cancelled,
    source: row,
    reviewed: true,
  };
}
export const emptyTrade = (): TradeDraft => ({
  price: null,
  contractDate: null,
  floor: null,
  area: null,
  address: null,
  buildingName: null,
  cancelled: null,
  documentId: null,
  page: null,
  quote: null,
  needsReview: true,
});
