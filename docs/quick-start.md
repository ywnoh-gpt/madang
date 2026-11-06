# 처음 한 번만 하는 연결

코드 수정·검증·GitHub 반영은 개발 작업에서 처리합니다. 최초 서비스 가입·프로젝트 연결·키 등록은 본인 계정에서 진행해야 합니다. Vercel을 GitHub에 연결한 뒤에는 `main`에 코드를 올리면 화면·서버 코드가 자동 배포됩니다. DB 구조를 바꾸는 후속 작업에는 별도 마이그레이션 적용이 필요합니다.

## 1. 기록을 보관할 Supabase 프로젝트 만들기

1. [Supabase](https://supabase.com/dashboard)에 **GitHub 계정으로 로그인**합니다.
2. **New project**를 선택합니다. 처음이라면 무료 조직을 먼저 만듭니다.
3. 이름은 `madang`, 데이터베이스 비밀번호는 본인이 보관할 값으로 정하고 프로젝트를 만듭니다. 무료 플랜으로 시작할 수 있습니다.
4. 프로젝트의 **SQL Editor → New query**에서 [준비된 SQL](https://github.com/ywnoh-gpt/madang/blob/main/supabase/migrations/202611040001_madang.sql) 전체를 복사해 **한 번 실행**합니다. 이는 기록 테이블과 비공개 파일 저장소를 함께 준비합니다. 기존 프로젝트에 같은 이름의 테이블이 있으면 덮어쓰지 않으므로, 오류가 나면 반복 실행하기 전에 확인합니다.
5. 프로젝트의 **Connect / Project Settings → API 또는 API Keys**에서 프로젝트 URL과 **publishable/anon 공개 키**를 확인합니다. 서비스 역할 키·DB 비밀번호는 웹앱 설정에 넣지 않습니다.

## 2. Vercel에서 madang 연결하기

1. [Vercel](https://vercel.com/new)에 **GitHub 계정으로 로그인**합니다.
2. GitHub 접근 승인 후 **`ywnoh-gpt/madang`** 저장소를 Import합니다. 저장소가 보이지 않으면 GitHub 앱의 접근 허용 목록에서 `madang`을 선택합니다.
3. 기본 브랜치는 `main`, Framework는 **Vite**, Root Directory는 **저장소 루트**를 사용합니다. Vercel이 코드에서 설정을 읽습니다.
4. Environment Variables에 아래 **3개**를 등록하고 **Deploy**합니다. Gemini 모델은 별도 설정 없이 기존 기본값을 사용합니다.

| 이름                     | 넣을 값                                         |
| ------------------------ | ----------------------------------------------- |
| `VITE_SUPABASE_URL`      | 1단계에서 확인한 프로젝트 URL                   |
| `VITE_SUPABASE_ANON_KEY` | 같은 프로젝트의 publishable/anon 공개 키        |
| `GEMINI_API_KEY`         | 본인의 Gemini API 키 — Vercel 환경변수에만 입력 |

Supabase 주소·공개 키는 화면과 서버가 함께 사용하므로 두 번 등록할 필요가 없습니다. Gemini 키는 서버에서만 사용합니다. 키를 채팅이나 GitHub 파일에 붙이지 않습니다.

## 3. 발급된 웹주소 등록하기

1. Vercel에서 발급된 `https://...vercel.app` 주소를 복사합니다.
2. Supabase의 **Authentication → URL Configuration**에서 **Site URL**과 **Redirect URLs**에 그 주소를 등록합니다.
3. Vercel 주소를 열어 회원가입·인증 메일 확인·로그인을 진행합니다. 이메일 인증을 사용하는 경우 Supabase Email provider 설정과 발송 한도도 확인합니다.

처음에는 수동 기록 저장을 확인하고, 그다음 캡처/PDF 분석을 한 번 확인하세요. 실제 서비스 연결 전의 자동 테스트는 Google·Supabase 실사용 연결 성공을 의미하지 않습니다.

지금 GitHub Pages의 주소는 이 앱의 실행 주소로 사용하지 않습니다. 로그인·파일·AI 서버가 포함된 현재 버전은 Vercel 주소로 접속합니다. 자세한 개발 설정은 [README](../README.md)에 있습니다.

## 개인용으로 사용하기

본인 계정 하나로 사용하는 기록장입니다. 로그인은 공개 웹주소를 통해 개인 기록과 AI 사용에 접근하기 위한 본인 확인입니다. 같은 브라우저에서는 세션을 기억하고 갱신하며, 로그아웃·브라우저 데이터 삭제·세션 정책에 따라 다시 확인할 수 있습니다. 브라우저에서 로그인을 생략하기 위해 RLS를 해제하거나 비밀 키를 넣으면 안 됩니다.

본인 계정을 만들고 로그인을 확인한 뒤에는 Supabase Authentication의 **Allow new users to sign up** 설정을 끄면 새 계정 생성을 막을 수 있습니다. 이미 만든 본인 계정으로 로그인하고 비밀번호를 재설정할 수 있습니다. 처음 연결하기 전에는 계정부터 준비하세요.

### 가입할 때 Invalid path specified in request URL이 나오는 경우

이는 계정 개수나 비밀번호 복잡도보다는 인증 요청 주소를 먼저 확인해야 하는 오류입니다. 예를 들어 `VITE_SUPABASE_URL`에 `/rest/v1`이 있으면 라이브러리는 `/rest/v1/auth/v1/signup`으로 요청합니다. 실제 원인은 등록된 값과 응답을 확인해야 확정할 수 있습니다.

1. Supabase 프로젝트의 **Connect 또는 API 설정 → Project URL**을 복사합니다. 형식은 `https://프로젝트ID.supabase.co`입니다.
2. Vercel 프로젝트의 **Settings → Environment Variables → `VITE_SUPABASE_URL`**에 넣습니다. Supabase 관리 페이지 주소, Vercel 웹주소, `/auth/v1`, `/rest/v1`, `/storage/v1` 등이 붙은 주소는 사용하지 않습니다.
3. `VITE_SUPABASE_ANON_KEY`에는 같은 프로젝트의 **publishable 또는 anon 공개 키**를 넣습니다. `sb_secret_` 및 `service_role` 키는 화면용 키가 아닙니다.
4. 값을 바꾼 뒤 **Deployments → 최근 배포의 ⋯ → Redeploy**를 누르고, 새 배포가 Ready가 되면 새로고침합니다. 공개 환경변수는 빌드할 때 적용되므로 저장만 하면 기존 화면이 갱신되지는 않습니다.

앱은 알려진 잘못된 주소·경로·키 형식을 가입 전에 안내합니다. 형식 검사를 통과해도 실제 프로젝트 활성 상태와 공개 키의 유효성까지 확인한 것은 아닙니다. 문제를 공유할 때는 Project URL만 전달하고 키·비밀번호는 보내지 않습니다.
