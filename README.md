# madang

부동산 경매를 시작하기 전, 모의 입찰을 기록하고 예측 정확도를 복기하는 기록장입니다. WealthOS와 별도 프로젝트입니다.

## 독립 HTML 웹앱 — 현재 개발 버전

**캡처·PDF → AI 인식 → 원본 대조·수정 → 브라우저 저장 → 결과·성과 복기**를 한 화면에서 사용합니다. Google Apps Script나 스프레드시트 설치가 필요 없습니다.

- [사용·실행·GitHub Pages 게시 안내](docs/html-app.md)
- [단일 HTML 실행 파일](index.html) · 외부 UI 라이브러리 없이 실행
- [개발 소스](web) · 빌드: `node tools/build_web.cjs`
- 로컬 실행: `python3 -m http.server 8000 --bind 127.0.0.1` 후 `http://localhost:8000`

개인 기록은 **현재 브라우저의 IndexedDB**에 저장됩니다. GitHub에는 코드만 올라가며 기기 간 자동 동기화는 하지 않습니다. JSON 백업·복원과 기존 시트 CSV 가져오기를 지원합니다. AI 사용 시에만 직접 입력한 Gemini 키로 Google에 요청하며, 키는 창의 메모리에만 보관합니다. 기존 Apps Script 속성의 키·기록은 자동으로 이전되지 않습니다.

## 기존 Google 스프레드시트 앱

**캡처·PDF 업로드 → Gemini 인식 → 원본과 대조·수정 → 시트 저장 → 결과 복기**를 지원합니다. 스프레드시트 위의 넓은 입력창에서 작성하고 저장 후 닫을 수 있습니다. 작은 사이드바와 별도 웹앱 화면도 선택할 수 있습니다.

- [설치와 사용 안내](docs/google-sheets-app.md)
- [한 번에 붙여 넣는 Apps Script 코드](dist/Madang.gs)
- [개발 소스](apps-script)

최초 Google 계정 승인과 Gemini API 키 설정이 필요합니다. 키는 코드나 시트에 넣지 않습니다. 실제 Google/Gemini 연결은 계정 설정 후 확인해야 합니다.

## 엑셀 템플릿

- [엑셀 기록장 — 50회차](templates/madang-auction-journal-50.xlsx) · 약 25KB
- [엑셀 기록장 — 300회차](templates/madang-auction-journal.xlsx)
- [사용 안내·생성·검증 방법](docs/README.md)
- [물건별 상세 메모 템플릿](docs/property-note.md)

예상 낙찰가·가상 입찰가·내 입찰 상한가를 구분하고, 원본 예측을 기준으로 오차율과 모의 입찰 결과를 비교합니다. 먼저 20~30건을 기록한 후 전용 도구를 검토합니다.
