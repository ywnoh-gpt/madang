import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { money, errorText } from '../domain/journal';
import { simulationDefaults, simulate, type SimulationInput } from '../domain/simulator';
import { saveSimulation } from '../lib/data';
export function Simulator({
  recordId,
  initialBid,
  onSaved,
}: {
  recordId: string;
  initialBid: number | null;
  onSaved: () => Promise<void>;
}) {
  const [input, setInput] = useState<SimulationInput>({
      ...simulationDefaults,
      bid: initialBid || simulationDefaults.bid,
    }),
    [name, setName] = useState('기본 시나리오'),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const output = useMemo(() => {
    try {
      return simulate(input);
    } catch {
      return null;
    }
  }, [input]);
  const set = (key: keyof SimulationInput, value: unknown) =>
    setInput((i) => ({
      ...i,
      [key]: value,
      assumptionsConfirmed: key === 'assumptionsConfirmed' ? Boolean(value) : false,
    }));
  const field = (key: keyof SimulationInput, label: string) => (
    <label className="field" key={key}>
      <span>{label}</span>
      <input
        type="number"
        step={key.toLowerCase().includes('rate') || key === 'buildingShare' ? '.01' : '1'}
        min={key === 'housingGainAdjustment' ? undefined : 0}
        max={key.toLowerCase().includes('rate') || key === 'buildingShare' ? 100 : 1e13}
        value={Number(input[key])}
        onChange={(e) => set(key, e.target.value === '' ? 0 : Number(e.target.value))}
      />
    </label>
  );
  async function save() {
    setBusy(true);
    try {
      if (!input.note.trim()) throw new Error('세율·비용 가정과 확인 근거를 메모하세요.');
      await saveSimulation(recordId, input, name);
      await onSaved();
      setMessage('이 시나리오를 물건에 연결해 저장했습니다.');
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <p className="hint">
        법인 거래의 검토용 현금흐름 모델입니다. 세율은 자동 판정하지 않으며 0%에서 시작합니다.
        취득일·용도·면적·법인 상황에 맞는 세율과 추가 과세 여부를 확인해 입력하세요. 일반 법인세는
        해당 거래의 증분 실효세율로 계산하며 법인 전체 누진세 신고를 대체하지 않습니다.
      </p>
      <div className="simulator-grid">
        <div className="panel">
          <label className="field">
            물건 유형
            <select value={input.type} onChange={(e) => set('type', e.target.value)}>
              <option value="villa">저가 빌라</option>
              <option value="residentialOffice">주거용 오피스텔</option>
              <option value="businessOffice">업무용 오피스텔</option>
            </select>
          </label>
          <div className="field-grid">
            {field('bid', '낙찰가 (원)')}
            {field('sale', '매각가 (원)')}
            {field('operating', '운영비 (당기 비용)')}
            {field('capital', '자본적 지출 (취득원가 가산)')}
            {field('selling', '매각 부대비용')}
            {field('financing', '금융비용')}
          </div>
          <details open>
            <summary>취득세·부가세 가정</summary>
            <div className="field-grid">
              {field('acquisitionRate', '취득세 본세 (%)')}
              {field('educationRate', '지방교육세 (%)')}
              {field('ruralRate', '농어촌특별세 (%)')}
              {field('buildingShare', 'VAT 과세 건물 비중 (%)')}
              {field('purchaseVatRate', '취득 건물 VAT 세율 (%)')}
              {field('saleVatRate', '매각 건물 VAT 세율 (%)')}
              {field('inputCreditRate', '취득 VAT 공제 가능 비율 (%)')}
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={input.purchaseIncludesVat}
                onChange={(e) => set('purchaseIncludesVat', e.target.checked)}
              />
              입력 낙찰가에 VAT 포함
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={input.saleIncludesVat}
                onChange={(e) => set('saleIncludesVat', e.target.checked)}
              />
              입력 매각가에 VAT 포함
            </label>
          </details>
          <details open>
            <summary>법인세 가정</summary>
            <div className="field-grid">
              {field('corporateRate', '일반 법인세 증분 실효세율 (%)')}
              {field('housingAdditionalRate', '주택 추가 법인세율 (%)')}
              {field('localCorporateRate', '산출 법인세 대비 지방 법인세 (%)')}
              {field('housingGainAdjustment', '주택 추가 과표 조정액 (±원)')}
            </div>
            <label className="check">
              <input
                type="checkbox"
                checked={input.localOnAdditional}
                onChange={(e) => set('localOnAdditional', e.target.checked)}
              />
              지방 법인세 계산에 주택 추가세도 포함
            </label>
            <p className="hint">
              업무용 오피스텔 유형의 주택 추가세는 0으로 계산합니다. 주거용 판정·저가 주택 예외·VAT
              공제 여부는 직접 검토하세요. 운영비와 자본적 지출 금액은 VAT 공제 등을 반영한 최종
              비용으로 입력합니다.
            </p>
          </details>
        </div>
        <div>
          <div className="panel">
            <h3>세금과 순이익</h3>
            {output ? (
              <>
                <div className="limit-box">
                  <span>예상 순이익</span>
                  <strong>{money(output.netProfit)}</strong>
                </div>
                <div
                  className="chart"
                  role="img"
                  aria-label="취득세·부가세·법인세·순이익 누적 막대그래프"
                >
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart
                      data={[
                        {
                          name: '세금·이익',
                          취득세: output.acquisitionTotal,
                          부가세정산: output.vatSettlement,
                          일반법인세: output.generalCorporate,
                          주택추가세: output.housingAdditional,
                          지방법인세: output.localCorporate,
                          순이익: output.netProfit,
                        },
                      ]}
                      stackOffset="sign"
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis tickFormatter={(v) => (v / 10000).toLocaleString() + '만'} />
                      <Tooltip formatter={(v) => money(Number(v))} />
                      <Legend />
                      {[
                        ['취득세', '#a6b58f'],
                        ['부가세정산', '#bba475'],
                        ['일반법인세', '#7e9baf'],
                        ['주택추가세', '#b88170'],
                        ['지방법인세', '#af9bb5'],
                        ['순이익', '#245c4c'],
                      ].map(([key, color]) => (
                        <Bar
                          key={key}
                          dataKey={key}
                          stackId="cash"
                          fill={color}
                          isAnimationActive={false}
                        />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <dl className="detail-grid">
                  {[
                    ['취득세 합계', output.acquisitionTotal],
                    ['취득 VAT', output.purchaseVat],
                    ['매각 VAT', output.saleVat],
                    ['공제 가정', output.inputCredit],
                    ['VAT 정산 (음수=환급 가정)', output.vatSettlement],
                    ['일반 법인세 과표', output.taxableProfit],
                    ['주택 추가세 과표', output.housingBase],
                    ['일반 법인세', output.generalCorporate],
                    ['주택 추가 법인세', output.housingAdditional],
                    ['지방 법인세', output.localCorporate],
                    ['취득원가+자본적 지출', output.costBasis],
                    ['순이익', output.netProfit],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{money(Number(value))}</dd>
                    </div>
                  ))}
                </dl>
              </>
            ) : (
              <p className="message error">금액·세율 범위를 확인하세요.</p>
            )}
          </div>
          <div className="panel">
            <label className="field">
              시나리오 이름
              <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field">
              가정·확인 근거 메모
              <textarea
                value={input.note}
                onChange={(e) => set('note', e.target.value)}
                placeholder="세율 확인 기준일, 실제 사용 용도, VAT 공제 가정 등"
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={input.assumptionsConfirmed}
                onChange={(e) => set('assumptionsConfirmed', e.target.checked)}
              />
              세율·용도·비용·공제 가정을 확인했습니다.
            </label>
            <button
              className="primary"
              onClick={save}
              disabled={busy || !output || !input.assumptionsConfirmed}
            >
              시뮬레이션 저장
            </button>
            {message && (
              <p role="status" className="message">
                {message}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
