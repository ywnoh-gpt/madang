import { lazy, Suspense, useEffect, useState } from 'react';
import {
  areaGroup,
  derive,
  emptyDraft,
  errorText,
  labels,
  money,
  pct,
  resultKeys,
  type Analysis,
  type AuctionRecord,
  type Draft,
  type FieldKey,
  type Tenant,
  type TradeDraft,
} from '../domain/journal';
import { emptyTrade, reviewTrade } from '../domain/trades';
import * as Data from '../lib/data';
import { Field } from './JournalForm';
import { SavedDocuments, UploadPanel } from './UploadPanel';
const Simulator = lazy(() =>
  import('./Simulator').then((module) => ({ default: module.Simulator })),
);
export function PropertyView({
  record,
  onChanged,
  onNext,
}: {
  record: AuctionRecord;
  onChanged: () => Promise<void>;
  onNext: (draft: Draft) => void;
}) {
  const [tab, setTab] = useState('basic'),
    [data, setData] = useState<Data.Detail | null>(null),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [selected, setSelected] = useState<Analysis | null>(null),
    [patch, setPatch] = useState(
      Object.fromEntries(resultKeys.map((k) => [k, String(record.fields[k] ?? '')])),
    ),
    [tradeRows, setTradeRows] = useState<TradeDraft[]>([]),
    [reviewed, setReviewed] = useState(false),
    [sameProperty, setSameProperty] = useState(false),
    [tenants, setTenants] = useState<Tenant[]>([]),
    [reason, setReason] = useState('');
  async function refresh() {
    setData(await Data.detail(record.id));
  }
  useEffect(() => {
    let active = true;
    Data.detail(record.id)
      .then((v) => {
        if (active) setData(v);
      })
      .catch((e) => {
        if (active) setMessage(errorText(e));
      });
    return () => {
      active = false;
    };
  }, [record.id]);
  async function action(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await work();
      setMessage('저장했습니다.');
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  function choose(analysis: Analysis) {
    setSelected(analysis);
    setReviewed(false);
    setReason('');
    if (analysis.mode === 'transactions') {
      setTab('trades');
      setTradeRows(analysis.result.transactions);
    }
    if (analysis.mode === 'tenancy') {
      setTab('tenancy');
      setTenants(analysis.result.tenants);
    }
  }
  const d = derive(record.fields),
    areas = Array.from(new Set((data?.trades || []).map((t) => t.area))).sort(
      (a, b) => (a ?? 0) - (b ?? 0),
    );
  const next = () => {
    if (!confirm('새 기일 기록을 만듭니다. 작성 중인 새 기록이 있다면 대체됩니다. 계속할까요?'))
      return;
    const draft: Draft = {
      ...emptyDraft(),
      ...Object.fromEntries(
        Object.keys(labels).map((k) => [k, String(record.fields[k as FieldKey] ?? '')]),
      ),
    };
    Object.assign(draft, {
      auctionDate: '',
      saleResult: '미확인',
      actualPrice: '',
      bidderCount: '',
      reviewNote: '',
      predictedPrice: '',
      virtualBid: '',
      forecastDate: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }),
      beforeResultConfirmed: false,
    });
    onNext(draft);
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">PROPERTY ANALYSIS</p>
          <h1>
            {record.fields.caseNumber} · 물건 {record.fields.itemNumber}
          </h1>
          <p>
            {record.fields.address || record.fields.court} · {record.fields.auctionDate}
          </p>
        </div>
        <button onClick={next}>다음 기일 기록</button>
      </div>
      <div className="tabbar">
        {[
          ['basic', '기본·복기'],
          ['tenancy', '점유·임차'],
          ['trades', '실거래가'],
          ['simulator', '수익 시뮬레이터'],
        ].map(([key, label]) => (
          <button key={key} className={tab === key ? 'primary' : ''} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      {message && (
        <p role="status" className="message">
          {message}
        </p>
      )}
      {!data && <p>기록을 불러오는 중입니다.</p>}
      {tab === 'basic' && (
        <>
          <section className="panel">
            <dl className="detail-grid">
              {Object.entries(labels).map(([key, label]) => (
                <div
                  key={key}
                  className={['rationale', 'reviewNote', 'address'].includes(key) ? 'wide' : ''}
                >
                  <dt>{label}</dt>
                  <dd>
                    {key.endsWith('Url') && record.fields[key as FieldKey] ? (
                      <a
                        href={String(record.fields[key as FieldKey])}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        링크 열기 ↗
                      </a>
                    ) : (
                      String(record.fields[key as FieldKey] ?? '—')
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            <div className="detail-comparisons">
              <span className="tag">상한가 {money(d.upperLimit)}</span>
              <span className="tag">최저가 {d.minimumComparison}</span>
              <span className="tag">실제 낙찰가 {d.actualComparison}</span>
              <span className="tag">상한가 {d.limitComparison}</span>
              <span className="tag">예측 오차 {pct(d.error, true)}</span>
            </div>
            <p className="hint">
              낙찰가 동액은 낙찰 여부를 확정할 수 없습니다. 낙찰 가능성과 투자 수익성은 별도로
              판단하세요.
            </p>
          </section>
          <form
            className="panel"
            onSubmit={(e) => {
              e.preventDefault();
              action(async () => {
                await Data.updateResult(record, patch);
                await onChanged();
                await refresh();
              });
            }}
          >
            <h2>결과·복기 입력</h2>
            <p className="hint">최초 예측은 보존하며 수정 전 결과는 DB 이력에 남깁니다.</p>
            <div className="field-grid">
              {resultKeys.map((key) => (
                <Field
                  key={key}
                  field={key}
                  prefix="result_"
                  value={patch[key]}
                  onChange={(v) => setPatch((p) => ({ ...p, [key]: v }))}
                />
              ))}
            </div>
            <button type="submit" className="primary" disabled={busy}>
              결과·복기 저장
            </button>
          </form>
          <SavedDocuments documents={data?.documents || []} />
          <details className="panel">
            <summary>최초 기록·변경 이력</summary>
            <pre>{JSON.stringify(data?.history, null, 2)}</pre>
          </details>
        </>
      )}
      {(tab === 'tenancy' || tab === 'trades') && (
        <>
          <UploadPanel
            key={record.id}
            recordId={record.id}
            onAnalysis={async (a) => {
              await Data.linkAnalysis(record.id, a);
              await refresh();
              choose(a);
            }}
          />
          <section className="panel">
            <h3>보관된 분석</h3>
            <div className="actions">
              {data?.analyses
                .filter((a) => a.mode === (tab === 'tenancy' ? 'tenancy' : 'transactions'))
                .map((a) => (
                  <button key={a.id} onClick={() => choose(a)}>
                    {new Date(a.created_at).toLocaleString('ko-KR')} · 검토
                  </button>
                ))}
            </div>
            {selected?.result.warnings.map((w, i) => (
              <p className="hint" key={i}>
                {w}
              </p>
            ))}
          </section>
        </>
      )}
      {tab === 'tenancy' && (
        <>
          <section className="panel">
            <h2>점유·임차 사실 검토</h2>
            <p className="message">
              원문에 근거한 사실 추출입니다. 대항력·우선변제·인수 여부에 대한 법적 결론은 제공하지
              않습니다. 모든 항목은 검토가 필요합니다.
            </p>
            {tenants.map((tenant, i) => (
              <div className="tenant-row" key={i}>
                <div className="field-grid">
                  {Object.entries({
                    occupant: '점유자·임차인',
                    unit: '점유 부분',
                    deposit: '보증금',
                    monthlyRent: '차임',
                    moveInDate: '전입일',
                    fixedDate: '확정일자',
                    distributionDemandDate: '배당요구일',
                    claim: '원문상 신고 내용',
                    quote: '원문 근거',
                  }).map(([key, label]) => (
                    <label className="field" key={key}>
                      {label}
                      <input
                        value={String(tenant[key as keyof Tenant] ?? '')}
                        onChange={(e) => {
                          setTenants((t) =>
                            t.map((v, index) =>
                              index === i ? { ...v, [key]: e.target.value } : v,
                            ),
                          );
                          setReviewed(false);
                        }}
                      />
                    </label>
                  ))}
                </div>
                <p className="hint">
                  출처 {tenant.documentId || '미확인'} ·{' '}
                  {tenant.page ? `${tenant.page}쪽` : '쪽수 미확인'} · 검토 필요
                </p>
              </div>
            ))}
            {tenants.length > 0 && (
              <>
                <label className="field">
                  검토·수정 사유
                  <textarea value={reason} onChange={(e) => setReason(e.target.value)} />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={reviewed}
                    onChange={(e) => setReviewed(e.target.checked)}
                  />
                  원문 근거와 수정값을 확인했습니다.
                </label>
                <button
                  disabled={!reviewed || !reason.trim() || busy}
                  onClick={() =>
                    action(async () => {
                      if (!selected) throw new Error('원본 분석을 선택하세요.');
                      await Data.saveReview(record.id, selected.id, tenants, reason);
                      await refresh();
                    })
                  }
                >
                  검토본 저장 (원본 유지)
                </button>
              </>
            )}
          </section>
          <details className="panel">
            <summary>점유·임차 검토 이력</summary>
            <pre>{JSON.stringify(data?.reviews, null, 2)}</pre>
          </details>
        </>
      )}
      {tab === 'trades' && (
        <>
          <section className="panel">
            <div className="panel-heading">
              <h2>거래 내역 검토·입력</h2>
              <button
                onClick={() => {
                  setTradeRows((rows) => [...rows, emptyTrade()]);
                  setReviewed(false);
                }}
              >
                거래 직접 추가
              </button>
            </div>
            {tradeRows.map((row, i) => (
              <div className="tenant-row" key={i}>
                <div className="field-grid">
                  {Object.entries({
                    price: '거래금액 (원·억·만)',
                    contractDate: '계약일 YYYY-MM-DD',
                    floor: '층 (원문)',
                    area: '전용면적 ㎡',
                    address: '주소·동',
                    buildingName: '건물명',
                    quote: '원문 근거',
                  }).map(([key, label]) => (
                    <label className="field" key={key}>
                      {label}
                      <input
                        value={String(row[key as keyof TradeDraft] ?? '')}
                        onChange={(e) => {
                          setTradeRows((rows) =>
                            rows.map((v, index) =>
                              index === i ? { ...v, [key]: e.target.value } : v,
                            ),
                          );
                          setReviewed(false);
                        }}
                      />
                    </label>
                  ))}
                  <label className="field">
                    거래 취소 여부
                    <select
                      value={row.cancelled == null ? 'unknown' : String(row.cancelled)}
                      onChange={(e) => {
                        setTradeRows((rows) =>
                          rows.map((v, index) =>
                            index === i
                              ? {
                                  ...v,
                                  cancelled:
                                    e.target.value === 'unknown' ? null : e.target.value === 'true',
                                }
                              : v,
                          ),
                        );
                        setReviewed(false);
                      }}
                    >
                      <option value="unknown">미확인</option>
                      <option value="false">정상 거래 확인</option>
                      <option value="true">취소 거래</option>
                    </select>
                  </label>
                </div>
                <button
                  onClick={() => setTradeRows((rows) => rows.filter((_, index) => i !== index))}
                >
                  이번 저장에서 제외
                </button>
              </div>
            ))}
            <label className="check">
              <input
                type="checkbox"
                checked={sameProperty}
                onChange={(e) => setSameProperty(e.target.checked)}
              />
              이 물건과 연결할 거래임을 주소·건물 기준으로 확인했습니다.
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={reviewed}
                onChange={(e) => setReviewed(e.target.checked)}
              />
              거래금액·계약일·층·전용면적·취소 여부를 확인했습니다.
            </label>
            <button
              className="primary"
              disabled={!tradeRows.length || !reviewed || !sameProperty || busy}
              onClick={() =>
                action(async () => {
                  await Data.saveTrades(tradeRows.map((row) => reviewTrade(row, record.id)));
                  setTradeRows([]);
                  setReviewed(false);
                  await refresh();
                })
              }
            >
              확인한 거래 저장
            </button>
          </section>
          <section className="panel">
            <h2>물건별 실거래 내역</h2>
            <p className="hint">
              면적이 다른 거래는 분리합니다. 취소 거래와 취소 여부 미확인 거래는 비교 요약에서
              제외합니다. 최저가: {money(record.fields.minimumPrice)}
            </p>
            {areas.map((area) => {
              const rows = data!.trades.filter((t) => t.area === area),
                comparable = rows.filter((t) => t.cancelled === false),
                mean = comparable.length
                  ? comparable.reduce((s, t) => s + t.price, 0) / comparable.length
                  : null;
              return (
                <section key={String(area)} className="area-group">
                  <h3>
                    {area ?? '미상'}㎡ · {areaGroup(area, record.fields.area)}
                  </h3>
                  <p>
                    확인 거래 평균 {money(mean)}{' '}
                    {mean && record.fields.minimumPrice
                      ? `· 최저가/평균 ${pct(record.fields.minimumPrice / mean)}`
                      : ''}
                  </p>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>계약일</th>
                          <th>층</th>
                          <th>거래금액</th>
                          <th>취소 여부</th>
                          <th>원문</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((t) => (
                          <tr key={t.id}>
                            <td>{t.contract_date}</td>
                            <td>{t.floor || '미상'}</td>
                            <td>{money(t.price)}</td>
                            <td>
                              {t.cancelled === null ? '미확인' : t.cancelled ? '취소' : '정상 확인'}
                            </td>
                            <td>{(t.source as TradeDraft)?.quote || '직접 입력'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              );
            })}
          </section>
        </>
      )}
      {tab === 'simulator' && (
        <>
          <Suspense fallback={<p>계산 화면을 불러오는 중입니다.</p>}>
            <Simulator
              recordId={record.id}
              initialBid={record.fields.virtualBid || record.fields.minimumPrice}
              onSaved={refresh}
            />
          </Suspense>
          <section className="panel">
            <h3>물건에 연결한 시뮬레이션</h3>
            {data?.simulations.map((sim) => (
              <details key={sim.id}>
                <summary>
                  {sim.name} · 순이익 {money(sim.output.netProfit)} ·{' '}
                  {new Date(sim.created_at).toLocaleString('ko-KR')}
                </summary>
                <pre>
                  {JSON.stringify(
                    { version: sim.version, input: sim.input, output: sim.output },
                    null,
                    2,
                  )}
                </pre>
              </details>
            ))}
          </section>
        </>
      )}
    </>
  );
}
