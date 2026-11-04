import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import * as Data from './lib/data';
import {
  errorText,
  exportCsv,
  metrics,
  money,
  parseCsv,
  pct,
  type AuctionRecord,
  type Draft,
} from './domain/journal';
import { JournalForm } from './components/JournalForm';
import { PropertyView } from './components/PropertyView';
function download(data: string, type: string, name: string) {
  const url = URL.createObjectURL(new Blob([data], { type })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Auth() {
  const [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [signup, setSignup] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const result = signup
        ? await Data.db().auth.signUp({
            email,
            password,
            options: { emailRedirectTo: location.origin },
          })
        : await Data.db().auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      setMessage(
        signup && !result.data.session
          ? '확인 메일을 보냈습니다. 메일의 링크로 인증한 후 로그인하세요.'
          : '로그인했습니다.',
      );
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-shell">
      <div className="auth-brand">
        <span className="brand-icon">ㅁ</span>
        <h1>마당</h1>
        <p>연습을 기록하고, 판단을 다듬는 공간</p>
      </div>
      <form className="panel" onSubmit={submit}>
        <h2>{signup ? '나의 기록장 만들기' : '내 기록장 로그인'}</h2>
        <p className="hint">PC와 모바일에서 같은 계정의 기록을 확인합니다.</p>
        <label className="field">
          이메일
          <input
            type="email"
            required
            value={email}
            autoComplete="email"
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          비밀번호
          <input
            type="password"
            required
            minLength={8}
            value={password}
            autoComplete={signup ? 'new-password' : 'current-password'}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <div className="actions">
          <button className="primary" disabled={busy}>
            {busy ? '확인 중…' : signup ? '계정 만들기' : '로그인'}
          </button>
          <button type="button" onClick={() => setSignup((v) => !v)}>
            {signup ? '로그인으로' : '회원가입'}
          </button>
          <button
            type="button"
            disabled={busy || !email}
            onClick={async () => {
              setBusy(true);
              try {
                const { error } = await Data.db().auth.resetPasswordForEmail(email, {
                  redirectTo: location.origin + '/#settings',
                });
                if (error) throw error;
                setMessage(
                  '비밀번호 재설정 메일을 확인하세요. 링크를 열면 설정에서 새 비밀번호를 저장할 수 있습니다.',
                );
              } catch (e) {
                setMessage(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            비밀번호 재설정
          </button>
        </div>
        {message && (
          <p role="status" className="message">
            {message}
          </p>
        )}
      </form>
    </div>
  );
}
function Dashboard({ session }: { session: Session }) {
  const [route, setRoute] = useState(location.hash.slice(1) || 'records'),
    [records, setRecords] = useState<AuctionRecord[]>([]),
    [loading, setLoading] = useState(true),
    [message, setMessage] = useState(''),
    [query, setQuery] = useState(''),
    [filter, setFilter] = useState(''),
    [seed, setSeed] = useState<Draft | undefined>(),
    [formVersion, setFormVersion] = useState(0),
    [password, setPassword] = useState(''),
    [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const go = (path: string) => {
    location.hash = path;
    setRoute(path);
    window.scrollTo(0, 0);
  };
  async function refresh() {
    setRecords(await Data.records());
  }
  useEffect(() => {
    let active = true;
    Data.records()
      .then((rows) => {
        if (active) setRecords(rows);
      })
      .catch((e) => {
        if (active) setMessage(errorText(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    const update = () => setRoute(location.hash.slice(1) || 'records');
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const m = metrics(records),
    selected = route.startsWith('property/')
      ? records.find((r) => r.id === route.slice(9))
      : undefined;
  async function importFile(file: File) {
    setBusy(true);
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('CSV는 10MB 이하여야 합니다.');
      const rows = parseCsv(await file.text());
      if (!confirm(`${rows.length}행을 가져올까요? 같은 물건·기일은 덮어쓰지 않고 건너뜁니다.`))
        return;
      const result = await Data.importRecords(rows);
      await refresh();
      setMessage(
        `${result.inserted}행 추가 · 중복 ${result.skipped}행 건너뜀. 기존 기록은 유지했습니다.`,
      );
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }
  return (
    <>
      <aside className="sidebar">
        <a
          className="brand"
          href="#records"
          onClick={(e) => {
            e.preventDefault();
            go('records');
          }}
        >
          <span className="brand-icon">ㅁ</span>
          <span>
            마당<small>경매 분석 기록장</small>
          </span>
        </a>
        <nav aria-label="주 메뉴">
          {[
            ['records', '물건 기록'],
            ['new', '＋ 새 기록 작성'],
            ['settings', '계정·데이터 설정'],
            ['guide', '사용 안내'],
          ].map(([key, label]) => (
            <button
              key={key}
              className={'nav ' + (route === key ? 'active' : '')}
              aria-label={label}
              onClick={() => go(key)}
            >
              {label}
              {key === 'records' && <span>{records.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="storage-dot" />내 계정에 저장<small>{session.user.email}</small>
          <button
            onClick={async () => {
              try {
                const { error } = await Data.db().auth.signOut();
                if (error) throw error;
              } catch (e) {
                setMessage(errorText(e));
              }
            }}
          >
            로그아웃
          </button>
          <a href="https://github.com/ywnoh-gpt/madang" target="_blank" rel="noopener noreferrer">
            GitHub · madang ↗
          </a>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>연습을 기록하고, 판단을 다듬는 공간</span>
          <span className="private-badge">개인 계정 · 클라우드 기록장</span>
        </header>
        {message && (
          <div className="message" role="status">
            {message}
          </div>
        )}
        {loading && <p>기록을 불러오는 중입니다.</p>}
        <section hidden={route !== 'records'}>
          <div className="page-heading">
            <div>
              <p className="eyebrow">MY AUCTION JOURNAL</p>
              <h1>물건 기록</h1>
              <p>예상과 결과 사이, 나의 판단을 차곡차곡 쌓아 보세요.</p>
            </div>
            <button className="primary" onClick={() => go('new')}>
              ＋ 새 물건 기록
            </button>
          </div>
          <div className="metrics">
            {[
              ['평가 가능한 기록', m.n + '건', '결과 확인 전 작성한 예측'],
              ['평균 절대 오차율', pct(m.absolute), '0%에 가까울수록 정확'],
              ['평균 예측 오차율', pct(m.signed, true), '＋ 높게 예상 · − 낮게 예상'],
              ['오차 5% 이내', m.near + '건', m.ratio == null ? '평가 기록 없음' : pct(m.ratio)],
            ].map(([label, value, hint]) => (
              <article key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
                <small>{hint}</small>
              </article>
            ))}
          </div>
          <section className="panel">
            <div className="panel-heading">
              <h2>
                나의 입찰 노트 <span>{records.length}건</span>
              </h2>
              <div className="actions">
                <button disabled={busy} onClick={() => fileInput.current?.click()}>
                  CSV 가져오기
                </button>
                <button
                  onClick={() =>
                    download(exportCsv(records), 'text/csv;charset=utf-8', 'madang-records.csv')
                  }
                >
                  CSV 내보내기
                </button>
                <button onClick={() => refresh().catch((e) => setMessage(errorText(e)))}>
                  새로고침
                </button>
              </div>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              aria-label="기존 기록 CSV"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) importFile(file);
              }}
            />
            <div className="filters">
              <input
                type="search"
                aria-label="기록 검색"
                placeholder="사건번호, 주소, 법원 검색"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <select
                aria-label="매각 결과 필터"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="">모든 결과</option>
                {['미확인', '낙찰', '유찰', '변경', '연기', '취하', '기각'].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>물건 / 사건번호</th>
                    <th>매각기일</th>
                    <th>예상 낙찰가</th>
                    <th>가상 입찰가</th>
                    <th>실제 낙찰가</th>
                    <th>결과</th>
                    <th>상세</th>
                  </tr>
                </thead>
                <tbody>
                  {records
                    .filter(
                      (r) =>
                        (!filter || r.fields.saleResult === filter) &&
                        [r.fields.address, r.fields.caseNumber, r.fields.court]
                          .join(' ')
                          .toLowerCase()
                          .includes(query.toLowerCase()),
                    )
                    .map((r) => (
                      <tr key={r.id}>
                        <td>
                          <strong>{r.fields.address || r.fields.court}</strong>
                          <small>
                            {r.fields.caseNumber} · 물건 {r.fields.itemNumber}
                          </small>
                        </td>
                        <td>{r.fields.auctionDate}</td>
                        <td>{money(r.fields.predictedPrice)}</td>
                        <td>{money(r.fields.virtualBid)}</td>
                        <td>{money(r.fields.actualPrice)}</td>
                        <td>
                          <span className="tag">{r.fields.saleResult}</span>
                        </td>
                        <td>
                          <button onClick={() => go('property/' + r.id)}>상세·분석</button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {!records.length && !loading && (
              <div className="empty">
                <div className="empty-icon">⌂</div>
                <h3>첫 번째 판단을 기록해 보세요</h3>
                <p>캡처·PDF를 올리거나 직접 입력할 수 있어요.</p>
                <button className="primary" onClick={() => go('new')}>
                  첫 물건 기록하기
                </button>
              </div>
            )}
          </section>
        </section>
        <section hidden={route !== 'new'}>
          <JournalForm
            key={formVersion}
            initial={seed}
            onSaved={async () => {
              await refresh();
              setFormVersion((v) => v + 1);
              setSeed(undefined);
              go('records');
              setMessage('기록과 원본·분석 연결을 저장했습니다.');
            }}
          />
        </section>
        {selected && (
          <PropertyView
            key={selected.id}
            record={selected}
            onChanged={refresh}
            onNext={(draft) => {
              setSeed(draft);
              setFormVersion((v) => v + 1);
              go('new');
            }}
          />
        )}
        {route.startsWith('property/') && !selected && !loading && (
          <p>기록이 없거나 접근할 수 없습니다.</p>
        )}
        {route === 'settings' && (
          <section className="narrow">
            <div className="page-heading">
              <h1>계정·데이터 설정</h1>
            </div>
            <section className="panel">
              <h2>내 데이터</h2>
              <p>
                기록·원본·분석 결과는 로그인한 계정으로만 접근합니다. API 키는 서버 환경변수에서
                관리합니다.
              </p>
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    download(
                      JSON.stringify(await Data.backup(), null, 2),
                      'application/json',
                      'madang-metadata-backup.json',
                    );
                    setMessage(
                      '기록·분석·시뮬레이션 JSON 백업을 내려받았습니다. 원본 파일의 바이너리는 포함하지 않습니다.',
                    );
                  } catch (e) {
                    setMessage(errorText(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                데이터 JSON 백업
              </button>
              <p className="hint">
                원본은 물건 상세의 보관 원본에서 별도로 내려받으세요. 이전 HTML 앱의 브라우저 기록은
                기존 앱에서 CSV로 내보내 가져옵니다. 사이트 데이터는 자동 삭제하지 않습니다.
              </p>
            </section>
            <form
              className="panel"
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  const { error } = await Data.db().auth.updateUser({ password });
                  if (error) throw error;
                  setPassword('');
                  setMessage('비밀번호를 변경했습니다.');
                } catch (e) {
                  setMessage(errorText(e));
                }
              }}
            >
              <h2>비밀번호 변경</h2>
              <label className="field">
                새 비밀번호
                <input
                  type="password"
                  minLength={8}
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <button>비밀번호 저장</button>
            </form>
          </section>
        )}
        {route === 'guide' && (
          <section className="panel prose narrow">
            <h1>사용 안내</h1>
            <ol>
              <li>결과 확인 전에 물건을 기록합니다. 캡처·PDF 인식값은 원본과 비교해 수정합니다.</li>
              <li>
                예상 낙찰가·가상 입찰가·입찰 상한가를 구분합니다. 상한가는 시세 − 비용 − 목표
                이익입니다.
              </li>
              <li>물건 상세에서 점유·임차, 실거래 내역을 분석하고 원문 근거를 확인합니다.</li>
              <li>
                실거래는 주소·전용면적·계약일·층·취소 여부를 검토하고 저장합니다. 면적이 다른 거래는
                별도로 비교합니다.
              </li>
              <li>
                법인 시뮬레이터에서 세율·VAT·공제·운영비·자본적 지출 가정을 입력하고 저장합니다.
              </li>
              <li>
                매각 후 결과를 입력해 예측 정확도를 복기합니다. 최초 예측과 수정 전 결과는
                보존합니다.
              </li>
              <li>유찰 뒤 다음 기일은 새 행으로 추가합니다.</li>
            </ol>
            <h2>어떤 자료가 좋을까요?</h2>
            <p>
              물건 상세 화면 캡처는 법원·기일·최저가 확인에 좋습니다. 매각물건명세서와 등기부등본은
              상세 검토용이며 기일·최저가가 없을 수 있습니다. 실거래 캡처는 주소·건물명과 각 거래의
              면적·계약일·금액이 함께 보이게 준비하세요.
            </p>
            <h2>권리·세금 판단</h2>
            <p>
              AI는 확인하지 못한 정보를 비워 두고 원문 근거와 검토 필요 여부를 표시합니다.
              대항력·인수 여부·권리 안전성은 확정하지 않습니다. 시뮬레이터 세율은 0%에서 시작하며
              거래 시점의 법령과 법인 상황에 맞게 직접 검토해야 합니다.
            </p>
            <h2>성과 계산</h2>
            <p>
              예측 오차율 = (예상 낙찰가 − 실제 낙찰가) ÷ 실제 낙찰가. 평균 절대 오차율로 정확도를
              평가하며 5% 경계는 포함합니다. 결과 확인 전 예측과 유효한 날짜·실제 가격이 있는 낙찰
              기록만 평가합니다. 동액은 낙찰을 보장하지 않습니다.
            </p>
            <h2>데이터 이전</h2>
            <p>
              기존 시트의 ‘마당 기록’ 탭 또는 이전 HTML 앱에서 CSV를 내보낸 뒤 목록의 ‘CSV
              가져오기’로 옮기세요. 중복 행은 덮어쓰지 않습니다. 원본 파일·이전 수정 이력은 CSV로
              이전되지 않으므로 기존 자료와 백업을 보관하세요.
            </p>
          </section>
        )}
      </main>
    </>
  );
}
export default function App() {
  const [session, setSession] = useState<Session | null>(null),
    [ready, setReady] = useState(false),
    [error, setError] = useState('');
  useEffect(() => {
    if (!Data.supabase) {
      setReady(true);
      return;
    }
    const client = Data.supabase;
    let active = true;
    client.auth.getSession().then(({ data, error }) => {
      if (active) {
        if (error) setError(error.message);
        setSession(data.session);
        setReady(true);
      }
    });
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (active) {
        setSession(session);
        setReady(true);
        if (event === 'PASSWORD_RECOVERY') location.hash = 'settings';
      }
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);
  if (!Data.supabase)
    return (
      <div className="auth-shell">
        <div className="auth-brand">
          <h1>마당 · 경매 분석 기록장</h1>
        </div>
        <section className="panel">
          <h2>서비스 연결 설정이 필요합니다</h2>
          <p>
            Vercel에 Supabase 공개 URL·공개 키와 서버용 Gemini 키를 설정하고 DB 마이그레이션을
            적용하세요.
          </p>
          <a
            href="https://github.com/ywnoh-gpt/madang/blob/feat/react-supabase-auction/README.md"
            target="_blank"
            rel="noopener noreferrer"
          >
            Supabase·Vercel 설정 안내 ↗
          </a>
          <p className="hint">
            이 화면에서는 입력을 저장하거나 AI를 호출하지 않습니다. GitHub Pages는 서버 API를 실행할
            수 없으므로 이 버전은 Vercel에 배포합니다.
          </p>
        </section>
      </div>
    );
  if (!ready) return <p className="message">로그인을 확인하는 중입니다.</p>;
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {session ? <Dashboard key={session.user.id} session={session} /> : <Auth />}
    </>
  );
}
