# 마당 · 경매 분석 기록장

`ywnoh-gpt/madang`에서 관리하는 개인 경매 분석 서비스입니다. **React + Vite + TypeScript / Vercel Functions / Supabase Auth·PostgreSQL·Storage / Gemini**를 사용합니다. WealthOS와 별도 프로젝트입니다.

물건 캡처·PDF → 서버 AI 추출 → 원문 대조·수정 → 계정별 저장 → 실거래 비교·수익 시뮬레이션 → 결과 복기를 지원합니다. Google Sheets와 Apps Script 실행 코드는 제거했습니다. 이전 코드와 자료는 Git 이력 및 기존 브랜치에 보존되어 있습니다.

[물건 목록 화면](docs/images/react-records.png) · [수익 시뮬레이터 화면](docs/images/react-simulator.png) · [모바일 화면](docs/images/react-mobile.png)

## 구현한 기능

- 이메일·비밀번호 가입/로그인, 이메일 확인, 비밀번호 재설정, 로그아웃. 같은 계정으로 PC·모바일에서 기록 조회.
- PNG/JPEG/WebP/PDF 최대 3개, 이미지 5MB·PDF 8MB·전체 12MB. 비공개 Storage에 직접 업로드하고 서버는 파일 ID만 받습니다.
- 경매 기본정보, 매각물건명세서 점유·임차, 실거래 내역을 각각 분석. 추측 금지, 불명확한 값 null, 원문·파일·쪽수·검토 필요 표시.
- 인식값 수정과 최초 인식값 보존. 점유·임차 검토본은 별도로 추가하며 법적 안전성은 판정하지 않습니다.
- 법원·사건·물건·기일당 한 기록. 최초 예측은 DB에서 수정 제한, 결과 수정 전후 이력 자동 보존.
- 예상 낙찰가·가상 입찰가·입찰 상한가 구분, 절대/부호 오차와 5% 경계 성과, 검색·결과 필터.
- 물건별 실거래 여러 건 저장, 거래금액·계약일·층·전용면적·취소 여부 검토, 면적별 분리 비교. 취소·취소 여부 미확인 거래는 비교 요약 제외.
- 저가 빌라/주거용·업무용 오피스텔 법인 현금흐름 시뮬레이터. 운영비·자본적 지출, 취득세·VAT·일반 법인세·주택 추가세·지방 법인세 구분, 누적 막대그래프, 물건별 시나리오 보관.
- 기존 CSV 이전(한 번에 500행), 오류 시 전체 취소, 중복 덮어쓰기 금지. JSON 메타데이터 백업.

**세율은 0%에서 시작하며 사용자가 확인해 입력합니다.** 일반 법인세는 거래의 증분 실효세율 가정입니다. 저가 주택 예외·주거용 판정·누진세 신고·VAT 공제의 법적 판정은 자동화하지 않습니다. [시뮬레이터 계산·가정](docs/simulator.md)을 확인하세요.

## 1. Supabase 준비

1. [Supabase Dashboard](https://supabase.com/dashboard)에서 프로젝트를 만듭니다. 기존 데이터를 사용하는 프로젝트라면 먼저 백업하세요. 프로젝트 삭제/reset 명령은 사용하지 않습니다.
2. **SQL Editor**에서 [마이그레이션 SQL](supabase/migrations/202611040001_madang.sql) 전체를 **한 번** 실행합니다. 테이블·RLS·불변 예측/감사 트리거·원자적 저장/CSV 함수·비공개 버킷을 함께 만듭니다. 기존 동명 테이블·버킷이 있으면 덮어쓰지 않고 트랜잭션이 실패하므로 원인을 확인하세요. 적용 후 반복 실행하지 마세요. Supabase CLI를 사용한다면 최초 `supabase init`으로 설정을 만들고 프로젝트 연결 후 `supabase db push`로 적용합니다.
3. **Authentication → Providers → Email**을 활성화하고 이메일 인증을 설정합니다. 인증 메일 발송 한도/운영용 SMTP는 본인 프로젝트에 맞게 설정하세요.
4. **Project Settings → API / API Keys**에서 프로젝트 URL과 publishable/anon 공개 키를 확인합니다. 서비스 역할 키는 이 앱에서 필요하지 않습니다.
5. 배포 후 **Authentication → URL Configuration**의 Site URL을 실제 Vercel 주소로 설정하고 Redirect URLs에 해당 주소와 필요 시 `http://localhost:5173`을 추가합니다. Preview 배포에서 인증 링크를 쓸 경우 해당 주소도 명시적으로 허용합니다.
6. Storage의 `auction-documents` 버킷은 **Private** 상태로 유지합니다. 마이그레이션에 포함된 소유자 정책을 해제하지 마세요.

사용자 분리는 `auth.uid()` 기반 RLS, 소유자 복합 외래키, Storage 경로 정책으로 강제합니다. 파일 링크는 로그인한 계정에서만 발급하며 120초 후 만료됩니다. 분석 사용량은 계정당 5분 5회입니다.

## 2. 로컬 실행

Node.js **22.12 이상**을 사용합니다.

```sh
npm ci
cp .env.example .env.local
# .env.local의 프로젝트 URL·공개 키와 서버 Gemini 키를 본인 값으로 설정
npm run dev
```

Vite 화면 주소는 `http://localhost:5173`입니다. **Vite 단독 실행은 /api/analyze를 실행하지 않습니다.** 로컬에서 AI까지 실행하려면 [Vercel CLI](https://vercel.com/docs/cli)를 설치하고 `vercel link`, `vercel env pull .env.local` 후 `vercel dev`를 사용하세요. Vercel 프로젝트 프레임워크는 Vite로 선택합니다. 브라우저 테스트는 로컬 `/api/analyze`를 테스트 대역으로 교체합니다.

| 환경변수                 | 설정 위치                      | 용도                                          |
| ------------------------ | ------------------------------ | --------------------------------------------- |
| `VITE_SUPABASE_URL`      | Vercel 빌드 / .env.local       | 공개 프로젝트 URL                             |
| `VITE_SUPABASE_ANON_KEY` | Vercel 빌드 / .env.local       | 공개 publishable/anon 키                      |
| `SUPABASE_URL`           | Vercel 서버 / .env.local       | 같은 프로젝트 URL                             |
| `SUPABASE_ANON_KEY`      | Vercel 서버 / .env.local       | 같은 프로젝트 공개 키, 사용자 JWT와 함께 사용 |
| `GEMINI_API_KEY`         | **Vercel 서버만** / .env.local | Gemini 비밀 키                                |
| `GEMINI_MODEL`           | Vercel 서버 / .env.local       | 기본 `gemini-flash-lite-latest`               |

실제 키를 GitHub·이슈·채팅·코드에 붙이지 마세요. `.env*`와 `.vercel/`은 Git에서 제외되며 `.env.example`만 공개 예제입니다. Gemini 키에 `VITE_` 접두사를 붙이면 안 됩니다. 브라우저 번들에는 Gemini 키·모델 호출 코드가 들어가지 않습니다. 기존 Apps Script에 등록한 키를 자동으로 가져오지 않습니다.

## 3. Vercel 배포 및 404 해결

이 버전은 **GitHub Pages에 배포하지 않습니다.** Pages는 Vercel Functions를 실행할 수 없습니다. 이전 Pages 404의 실제 설정은 이 환경에서 조회하지 못했으며, 새 앱의 실행 주소는 Vercel에서 발급합니다.

1. 이 변경 브랜치 `feat/react-supabase-auction`을 검토 후 `main`으로 병합합니다. 기존 코드·개인 데이터는 Git 이력·기존 서비스에 남습니다. [변경 비교](https://github.com/ywnoh-gpt/madang/compare/main...feat/react-supabase-auction).
2. [Vercel 새 프로젝트](https://vercel.com/new)에서 GitHub 저장소 **`ywnoh-gpt/madang`**를 Import합니다.
3. Framework **Vite**, Root Directory **저장소 루트(`./`)**, Build Command **`npm run build`**, Output Directory **`dist`**, Node **22.x 이상**으로 설정합니다. `apps-script`나 `web` 폴더를 루트로 선택하지 마세요.
4. 위 환경변수를 Production과 테스트할 Preview 환경에 등록하고 Deploy합니다. `main` 병합 전 브랜치 배포를 검토하려면 Vercel Git 설정/새 배포의 Git ref에서 `feat/react-supabase-auction`을 선택합니다.
5. 발급된 `https://...vercel.app` 주소를 Supabase Auth URL 설정에 등록합니다.
6. 로그인 → 직접 기록 저장/조회 → PDF 기본정보 추출 → 점유·임차/거래 검토 → 시뮬레이터 저장을 확인합니다. **실제 AI 성공은 이 배포에서 확인해야 합니다.**
7. 프런트 공개 환경변수를 바꾼 경우 새 빌드·재배포가 필요합니다. `/api/analyze`가 404라면 Vercel 배포 여부, Root Directory, `api/analyze.ts` 포함 여부와 Functions 목록을 확인합니다. 로그인 API 401/403은 Supabase URL·공개 키·메일 인증을 확인합니다.

`vercel.json`은 API 경로를 HTML 재작성에서 제외합니다. GitHub에 코드를 푸시하는 것만으로 Supabase 프로젝트나 Vercel 환경변수가 만들어지지는 않습니다.

## 데이터 이전과 보존

[CSV 이전·원본 보존 안내](docs/migration.md)를 따르세요. 앱은 기존 Google 시트·Apps Script·이전 브라우저 저장 공간에 접속하거나 삭제하지 않습니다. CSV는 원본 파일·기존 변경 이력을 담지 않으므로 기존 백업과 원본을 유지하세요. 가져오기에서 같은 물건·기일은 덮어쓰지 않고 건너뜁니다. 기존과 내용이 달라도 자동 갱신하지 않습니다.

앱의 JSON 백업은 DB 기록·문서 메타데이터·분석·검토본·거래·시뮬레이션·이력을 포함합니다. Storage 파일 바이너리는 포함하지 않으므로 원본은 상세 화면에서 별도로 보관하세요. JSON 백업 복원 UI는 제공하지 않으며 기존 데이터 이전은 CSV를 사용합니다.

## 개발 구조와 검증

```text
src/                   React 화면·타입·계산·CSV·Supabase 클라이언트
api/analyze.ts         Vercel 엔드포인트
server/                인증·소유권·사용량·파일 검증·Gemini 요청
supabase/migrations/   테이블·RLS·비공개 Storage·감사·저장/이전 함수
tests/unit/            계산·서버 경계·실제 PostgreSQL(PGlite) 검증
tests/e2e/             실제 Chromium + 모의 Supabase/AI 사용 흐름
```

```sh
npm run test
npm run build
npm run test:browser
```

Playwright 테스트는 설치된 Chromium 또는 `CHROMIUM_PATH`를 사용합니다. 없으면 `npx playwright install chromium`으로 설치합니다. [검증 결과와 실제 서비스 확인 범위](docs/validation.md)를 확인하세요. 자동 테스트의 AI 성공은 실제 Gemini 접속 성공을 뜻하지 않습니다.

## 이전 버전

- [전환 전 HTML·Apps Script 코드 보관본](https://github.com/ywnoh-gpt/madang/tree/b671e28ec1105be3da9b88a5cea03fce0d6a828d)
- [엑셀 50회차](templates/madang-auction-journal-50.xlsx) / [300회차](templates/madang-auction-journal.xlsx)와 [엑셀 안내](docs/README.md)는 보존했습니다.
