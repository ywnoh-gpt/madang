# madang

부동산 경매를 시작하기 전, 모의 입찰을 기록하고 예측 정확도를 복기하는 기록장입니다. WealthOS와 별도 프로젝트입니다.

## Google 스프레드시트 앱

**캡처·PDF 업로드 → Gemini 인식 → 원본과 대조·수정 → 시트 저장 → 결과 복기**를 지원합니다. 스프레드시트 옆의 사이드바 또는 넓은 웹앱 화면으로 사용합니다.

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
