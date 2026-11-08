import { useEffect, useState } from 'react';
import {
  checkPrediction,
  derive,
  emptyDraft,
  errorText,
  labels,
  money,
  moneyKeys,
  normalize,
  saleResults,
  type Analysis,
  type DocumentRow,
  type Draft,
  type FieldKey,
} from '../domain/journal';
import { saveRecord } from '../lib/data';
import { UploadPanel } from './UploadPanel';
export function Field({
  field,
  value,
  onChange,
  prefix = '',
  required = false,
}: {
  field: FieldKey;
  value: string;
  onChange: (value: string) => void;
  prefix?: string;
  required?: boolean;
}) {
  const id = prefix + field,
    props = {
      id,
      value,
      onChange: (
        e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
      ) => onChange(e.target.value),
      required,
    };
  return (
    <label
      className={
        'field ' +
        (['address', 'rationale', 'reviewNote', 'memoUrl', 'sourceUrl'].includes(field)
          ? 'wide'
          : '')
      }
      htmlFor={id}
    >
      <span>
        {labels[field]}
        {required ? ' *' : ''}
      </span>
      {field === 'saleResult' ? (
        <select {...props}>
          {saleResults.map((v) => (
            <option key={v}>{v}</option>
          ))}
        </select>
      ) : ['rationale', 'reviewNote'].includes(field) ? (
        <textarea {...props} maxLength={4000} />
      ) : (
        <input
          {...props}
          type={field.endsWith('Date') ? 'date' : field.endsWith('Url') ? 'url' : 'text'}
          inputMode={moneyKeys.includes(field) || field === 'area' ? 'decimal' : undefined}
          placeholder={field === 'area' ? '예: 48.72 또는 건물 48.72㎡' : undefined}
          maxLength={2000}
          title={
            field === 'itemNumber' ? '같은 사건 안에서 물건을 구분하는 번호입니다.' : undefined
          }
        />
      )}
    </label>
  );
}
export function JournalForm({
  onSaved,
  initial,
}: {
  onSaved: () => Promise<void>;
  initial?: Draft;
}) {
  const [draft, setDraft] = useState<Draft>(initial || emptyDraft),
    [documents, setDocuments] = useState<DocumentRow[]>([]),
    [analyses, setAnalyses] = useState<Analysis[]>([]),
    [reviewed, setReviewed] = useState(false),
    [corrected, setCorrected] = useState(false),
    [reason, setReason] = useState(''),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false),
    [message, setMessage] = useState(''),
    [last, setLast] = useState<Analysis | null>(null);
  const set = (key: FieldKey, value: string) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setReviewed(false);
  };
  useEffect(() => {
    const dirty =
      documents.length > 0 ||
      analyses.length > 0 ||
      Object.entries(draft).some(
        ([key, value]) =>
          !['forecastDate', 'saleResult', 'beforeResultConfirmed'].includes(key) && value !== '',
      );
    const warn = (e: BeforeUnloadEvent) => {
      if (!saved && (dirty || busy)) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draft, documents, analyses, saved, busy]);
  let upper: number | null = null;
  try {
    upper = derive(normalize(draft, false)).upperLimit;
  } catch {
    /* retain editable invalid input */
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || saved) return;
    setBusy(true);
    let committed = false;
    try {
      if (!reviewed) throw new Error('원본 대조를 확인하세요.');
      const fields = normalize(draft);
      checkPrediction(
        fields,
        analyses.find((a) => a.mode === 'auction')?.result || null,
        corrected,
        reason,
      );
      await saveRecord(fields, documents, analyses, {
        reviewed,
        resultCorrected: corrected,
        reason,
      });
      committed = true;
      setSaved(true);
      await onSaved();
    } catch (e) {
      setMessage(
        committed
          ? '기록은 저장됐지만 목록을 불러오지 못했습니다. 중복 저장하지 말고 물건 기록에서 새로고침하세요.'
          : errorText(e),
      );
    } finally {
      setBusy(false);
    }
  }
  const group = (keys: FieldKey[]) => (
    <div className="field-grid">
      {keys.map((key) => (
        <div
          key={key}
          className={
            ['address', 'rationale', 'reviewNote', 'memoUrl', 'sourceUrl'].includes(key)
              ? 'wide'
              : ''
          }
        >
          <Field
            field={key}
            value={draft[key]}
            required={['court', 'caseNumber', 'itemNumber', 'auctionDate'].includes(key)}
            onChange={(v) => set(key, v)}
          />
          {last?.result.evidence
            .filter((e) => e.field === key)
            .map((e, i) => (
              <small key={i} className="evidence">
                {e.quote || '원문 근거 확인 필요'} {e.page ? `· ${e.page}쪽` : ''} ·{' '}
                {e.needsReview ? '검토 필요' : '원본 대조 필요'}
              </small>
            ))}
        </div>
      ))}
    </div>
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">NEW ENTRY</p>
          <h1>새 물건 기록</h1>
          <p>자료의 사실과 나의 판단을 구분해서 기록하세요.</p>
        </div>
      </div>
      <div className="editor-grid">
        <form onSubmit={submit}>
          <section className="panel">
            <h2>물건 정보 확인</h2>
            {group([
              'court',
              'caseNumber',
              'itemNumber',
              'address',
              'propertyType',
              'area',
              'auctionDate',
              'appraisal',
              'minimumPrice',
              'failedAuctions',
            ])}
          </section>
          <section className="panel">
            <h2>나의 판단과 예측</h2>
            <p className="hint">금액은 원 단위 또는 ‘1억 2300만원’으로 입력하세요.</p>
            {group([
              'forecastDate',
              'predictedPrice',
              'virtualBid',
              'marketPrice',
              'extraCosts',
              'targetProfit',
              'rationale',
              'memoUrl',
            ])}
            <div className="limit-box">
              <span>내 입찰 상한가</span>
              <strong>{money(upper)}</strong>
              <small>예상 시세 − 추가 비용 − 목표 이익</small>
            </div>
          </section>
          <section className="panel">
            <details open={!!draft.actualPrice}>
              <summary>결과·출처 입력</summary>
              {group(['saleResult', 'actualPrice', 'bidderCount', 'reviewNote', 'sourceUrl'])}
            </details>
          </section>
          <section className="panel">
            <label className="check">
              <input
                type="checkbox"
                checked={draft.beforeResultConfirmed}
                onChange={(e) => {
                  setDraft((d) => ({ ...d, beforeResultConfirmed: e.target.checked }));
                  setReviewed(false);
                }}
              />
              결과 확인 전에 작성한 예측입니다.
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={corrected}
                onChange={(e) => {
                  setCorrected(e.target.checked);
                  setReviewed(false);
                }}
              />
              AI가 낙찰 결과를 오독해 수정했습니다.
            </label>
            <label className="field">
              수정 사유
              <input
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setReviewed(false);
                }}
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                required
                checked={reviewed}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              원본과 입력값을 대조했습니다. *
            </label>
            {message && (
              <p className="message error" role="status">
                {message}
              </p>
            )}
            <button className="primary" type="submit" disabled={busy || saved}>
              {saved ? '저장 완료' : busy ? '저장 중…' : '기록 저장하기'}
            </button>
          </section>
        </form>
        <aside className="preview-column">
          <UploadPanel
            onDocuments={setDocuments}
            onAnalysis={(analysis) => {
              setAnalyses((a) => [...a, analysis]);
              setLast(analysis);
              setReviewed(false);
              if (analysis.mode === 'auction')
                setDraft((d) => {
                  const updated = { ...d };
                  Object.entries(analysis.result.fields).forEach(([k, v]) => {
                    if (k in labels)
                      updated[k as FieldKey] = v ?? (k === 'saleResult' ? '미확인' : '');
                  });
                  return updated;
                });
            }}
          />
          {last && (
            <section className="panel">
              <h3>AI 검토 사항</h3>
              {last.result.warnings.map((w, i) => (
                <p key={i} className="hint">
                  {w}
                </p>
              ))}
              <p className="hint">
                점유·임차와 실거래 분석은 물건 저장 후 상세 화면에서 검토·연결할 수 있습니다.
              </p>
              <details>
                <summary>처음 읽은 값 보기</summary>
                <pre>{JSON.stringify(last.result, null, 2)}</pre>
              </details>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
