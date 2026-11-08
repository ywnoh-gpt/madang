// Parse one explicit square-metre value. Never collapse multiple figures or
// silently convert pyeong, supplied area, or a range into an exclusive area.
export function parseArea(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') {
    if (Number.isFinite(value) && value > 0) return value;
    throw areaError();
  }
  if (typeof value !== 'string') throw areaError();
  const text = value
    .normalize('NFKC')
    .trim()
    .replace(/^(?:건물(?:\s*면적)?|전용(?:\s*면적)?|면적)\s*:?\s*/, '');
  if (
    !text ||
    /^(?:미상|미확인|확인불가|정보없음|알\s*수\s*없음|없음|unknown|n\/?a|null|[-—–])$/i.test(text)
  )
    return null;
  const numeric = text.replace(/\s*(?:m\s*\^?\s*2|제곱\s*미터)\s*$/i, '').trim();
  if (!/^(?:\d+(?:\.\d+)?|\d{1,3}(?:,\d{3})+(?:\.\d+)?|\.\d+)$/.test(numeric)) throw areaError();
  const area = Number(numeric.replace(/,/g, ''));
  if (!Number.isFinite(area) || area <= 0) throw areaError();
  return area;
}

function areaError() {
  return new Error(
    '면적을 확인해 주세요. 예: 59.9 또는 59.9㎡. 여러 면적·범위·평 단위가 함께 있으면 저장할 ㎡ 값 하나를 입력하세요. 모르면 비워 두세요.',
  );
}
