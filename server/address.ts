import type { Extraction, Evidence } from '../src/domain/journal.js';

const compact = (value: string) => value.normalize('NFKC').replace(/\s+/g, '');
function extendsAddress(candidate: string, base: string) {
  if (!candidate.startsWith(base)) return false;
  // 100-2 must never match the different parcel 100-21.
  return !(/\d$/.test(base) && /^[\d-]/.test(candidate.slice(base.length)));
}
function detailSuffix(value: string, base: string) {
  const tail = value.slice(base.length);
  return (
    /\d+(?:동|층|호)|아파트|빌라|타운|오피스텔|빌딩|하우스|맨션|주택/.test(tail) ||
    (/\d$/.test(base) && /^(?:동|층|호)$/.test(tail))
  );
}

// Only use complete addresses explicitly quoted from the same uploaded material.
// This does not geocode, infer road names, or synthesize a building/unit number.
export function completeAddress(value: Pick<Extraction, 'fields' | 'evidence' | 'warnings'>) {
  const original = value.fields.address;
  if (!original?.trim()) return;
  const base = compact(original);
  let detailNeedsReview = false;
  const candidates = value.evidence.filter(
    (item): item is Evidence & { value: string; quote: string; documentId: string } => {
      if (
        !['address', 'addressTitle'].includes(item.field) ||
        !item.value ||
        !item.quote ||
        !item.documentId
      )
        return false;
      const candidate = compact(item.value),
        quote = compact(item.quote);
      if (
        candidate.length > 300 ||
        candidate.length <= base.length ||
        !extendsAddress(candidate, base) ||
        !detailSuffix(candidate, base)
      )
        return false;
      if (!quote.includes(candidate) || /[;|/]/.test(candidate)) {
        detailNeedsReview = true;
        item.needsReview = true;
        return false;
      }
      // Multiple units must stay a review task rather than choosing one silently.
      if (
        [candidate, quote].some(
          (text) => new Set(Array.from(text.matchAll(/\d+호(?!선)/g), (m) => m[0])).size > 1,
        )
      ) {
        detailNeedsReview = true;
        item.needsReview = true;
        return false;
      }
      return true;
    },
  );
  if (candidates.length) {
    const longest = [...candidates].sort(
      (a, b) => compact(b.value).length - compact(a.value).length,
    )[0];
    if (candidates.some((item) => !extendsAddress(compact(longest.value), compact(item.value)))) {
      value.evidence
        .filter((e) => ['address', 'addressTitle'].includes(e.field))
        .forEach((e) => (e.needsReview = true));
      value.warnings.push(
        '주소 후보의 건물·층·호수가 서로 다릅니다. 원본에서 해당 물건의 상세주소를 확인하세요.',
      );
      return;
    }
    const full = longest.value.trim().replace(/\s+/g, ' ');
    value.fields.address = full;
    if (!value.evidence.some((e) => e.field === 'address' && e.value === full)) {
      value.evidence.push({ ...longest, field: 'address', value: full, needsReview: true });
    }
    value.warnings.push(
      '물건 제목에서 확인한 상세주소를 반영했습니다. 건물명·동·층·호수를 원본과 대조하세요.',
    );
  } else if (
    detailNeedsReview ||
    (/아파트|다세대|연립|도시.*주택|오피스텔|빌라/.test(value.fields.propertyType || '') &&
      !/\d+\s*호/.test(original))
  ) {
    value.warnings.push(
      '주소에 호수가 확인되지 않았습니다. 물건 제목에 건물명·동·층·호수가 더 있는지 확인하세요. 확인되지 않은 값은 추가하지 않았습니다.',
    );
  }
}
