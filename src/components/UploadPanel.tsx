import { useEffect, useState } from 'react';
import { analyze, upload, signedUrl } from '../lib/data';
import { errorText, type Analysis, type AnalysisMode, type DocumentRow } from '../domain/journal';
export function UploadPanel({
  recordId,
  onDocuments,
  onAnalysis,
}: {
  recordId?: string;
  onDocuments?: (docs: DocumentRow[]) => void;
  onAnalysis: (analysis: Analysis) => void | Promise<void>;
}) {
  const [files, setFiles] = useState<File[]>([]),
    [documents, setDocuments] = useState<DocumentRow[]>([]),
    [mode, setMode] = useState<AnalysisMode>('auction'),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [selected, setSelected] = useState(0),
    [preview, setPreview] = useState('');
  useEffect(() => {
    const file = files[selected];
    if (!file) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [files, selected]);
  async function run() {
    if (busy) return;
    setBusy(true);
    setMessage('자료를 분석 중입니다. 중복 요청하지 마세요.');
    try {
      const docs = documents.length ? documents : await upload(files, recordId);
      setDocuments(docs);
      onDocuments?.(docs);
      const analysis = await analyze(mode, docs);
      await onAnalysis(analysis);
      setMessage('분석했습니다. 원문과 대조한 뒤 수정·저장하세요.');
    } catch (e) {
      setMessage(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel upload-panel">
      <div className="section-title">
        <span className="step">1</span>
        <h2>캡처·PDF 분석</h2>
      </div>
      <label className="dropzone">
        <input
          aria-label="캡처·PDF 파일"
          type="file"
          accept="image/png,image/jpeg,image/webp,application/pdf"
          multiple
          disabled={busy || documents.length > 0}
          onChange={(e) => {
            setFiles(Array.from(e.target.files || []));
            setSelected(0);
            setMessage('');
          }}
        />
        <strong>
          {documents.length
            ? '원본 업로드 완료 · 같은 자료로 분석 유형 변경 가능'
            : '캡처 또는 PDF를 선택하세요'}
        </strong>
        <span>최대 3개 · 이미지 5MB · PDF 8MB · 합계 12MB</span>
      </label>
      <div className="preview-tabs">
        {files.map((file, i) => (
          <button type="button" key={i} onClick={() => setSelected(i)}>
            {file.name}
          </button>
        ))}
      </div>
      {preview && (
        <div className="upload-preview">
          {files[selected]?.type === 'application/pdf' ? (
            <iframe title="업로드한 원본 PDF" src={preview + '#navpanes=0&view=FitH'} />
          ) : (
            <img alt="업로드한 원본" src={preview} />
          )}
          <a href={preview} target="_blank" rel="noopener noreferrer">
            원본 크게 보기 ↗
          </a>
        </div>
      )}
      <div className="actions">
        <select
          aria-label="분석 유형"
          value={mode}
          disabled={busy}
          onChange={(e) => setMode(e.target.value as AnalysisMode)}
        >
          <option value="auction">경매 기본정보</option>
          <option value="tenancy">점유·임차 정보</option>
          <option value="transactions">실거래 매매 내역</option>
        </select>
        <button type="button" className="primary" disabled={!files.length || busy} onClick={run}>
          {busy ? '분석 중…' : 'AI로 내용 읽기'}
        </button>
      </div>
      <p className="hint">
        선택한 파일은 비공개 저장소에 보관합니다. 분석 시 서버에서 Google Gemini로 전송하며,
        확인되지 않은 정보는 비워 둡니다.
      </p>
      {message && (
        <p className="message" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
export function SavedDocuments({ documents }: { documents: DocumentRow[] }) {
  const [message, setMessage] = useState('');
  async function open(doc: DocumentRow) {
    try {
      const url = await signedUrl(doc);
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.click();
    } catch (e) {
      setMessage(errorText(e));
    }
  }
  return (
    <div className="panel">
      <h3>보관 원본</h3>
      {documents.length ? (
        documents.map((d) => (
          <button key={d.id} onClick={() => open(d)}>
            {d.name} ↗
          </button>
        ))
      ) : (
        <p className="hint">보관된 원본이 없습니다.</p>
      )}
      <p className="hint">
        본인 파일의 단기 링크를 발급해 엽니다. 링크가 만료되면 다시 눌러 주세요.
      </p>
      {message && <p role="status">{message}</p>}
    </div>
  );
}
