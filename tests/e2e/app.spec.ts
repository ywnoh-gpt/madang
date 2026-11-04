import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
const uid = '11111111-1111-4111-8111-111111111111';
async function setup(page: Page) {
  const state: {
    records: any[];
    documents: any[];
    analyses: any[];
    links: any[];
    trades: any[];
    simulations: any[];
    reviews: any[];
    history: any[];
    apiCalls: number;
    googleCalls: number;
  } = {
    records: [],
    documents: [],
    analyses: [],
    links: [],
    trades: [],
    simulations: [],
    reviews: [],
    history: [],
    apiCalls: 0,
    googleCalls: 0,
  };
  const user = {
    id: uid,
    email: 'synthetic@example.test',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: { provider: 'email' },
    user_metadata: {},
    created_at: '2026-01-01T00:00:00Z',
  };
  const token =
    'eyJhbGciOiJIUzI1NiJ9.' +
    Buffer.from(
      JSON.stringify({
        sub: uid,
        exp: Math.floor(Date.now() / 1000) + 3600,
        role: 'authenticated',
      }),
    ).toString('base64url') +
    '.synthetic';
  page.on('request', (req) => {
    if (req.url().includes('generativelanguage.googleapis.com')) state.googleCalls++;
  });
  await page.route('https://test.supabase.co/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname,
      method = req.method();
    if (method === 'OPTIONS')
      return route.fulfill({
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-headers': '*',
          'access-control-allow-methods': '*',
        },
      });
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, json: body, headers: { 'access-control-allow-origin': '*' } });
    if (path.endsWith('/auth/v1/token'))
      return json({
        access_token: token,
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: 'synthetic-refresh',
        user,
      });
    if (path.endsWith('/auth/v1/user')) return json(user);
    if (path.endsWith('/auth/v1/logout'))
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
    if (path.includes('/storage/'))
      return json({
        Key: 'synthetic',
        signedURL: '/object/sign/auction-documents/example?token=synthetic',
      });
    const body = req.postData() ? JSON.parse(req.postData()!) : null;
    const row = (value: any) => ({
      ...value,
      id: value.id || randomUUID(),
      owner_id: uid,
      created_at: new Date().toISOString(),
    });
    if (path.endsWith('/rpc/create_auction_record')) {
      const f = body.payload;
      if (
        state.records.some(
          (r) =>
            r.fields.caseNumber === f.caseNumber &&
            r.fields.itemNumber === f.itemNumber &&
            r.fields.auctionDate === f.auctionDate,
        )
      )
        return json({ message: '같은 물건·기일이 이미 있습니다.' }, 409);
      const r = row({
        fields: f,
        court: f.court,
        case_number: f.caseNumber,
        item_number: f.itemNumber,
        auction_date: f.auctionDate,
      });
      state.records.push(r);
      state.history.push(row({ record_id: r.id, action: '최초 기록', after_value: r }));
      state.documents.forEach((d) => {
        if (body.p_document_ids.includes(d.id)) d.record_id = r.id;
      });
      body.p_analysis_ids.forEach((analysis_id: string) =>
        state.links.push({ record_id: r.id, analysis_id }),
      );
      return json(r);
    }
    if (path.endsWith('/rpc/import_auction_records')) {
      let inserted = 0,
        skipped = 0;
      for (const item of body.items) {
        if (
          state.records.some(
            (r) =>
              r.fields.caseNumber === item.fields.caseNumber &&
              r.fields.auctionDate === item.fields.auctionDate,
          )
        )
          skipped++;
        else {
          state.records.push(row({ fields: item.fields }));
          inserted++;
        }
      }
      return json({ inserted, skipped });
    }
    const table = path.split('/').pop(),
      map: Record<string, any[]> = {
        auction_records: state.records,
        documents: state.documents,
        analyses: state.analyses,
        record_analyses: state.links,
        transactions: state.trades,
        simulations: state.simulations,
        analysis_reviews: state.reviews,
        record_history: state.history,
      };
    const rows = map[table || ''];
    if (!rows) return json({ message: 'Unknown test route: ' + path }, 500);
    if (method === 'POST') {
      for (const value of Array.isArray(body) ? body : [body]) rows.push(row(value));
      return json(null, 201);
    }
    const selected = rows.filter((r) => {
      for (const [key, value] of url.searchParams) {
        if (value.startsWith('eq.') && String(r[key]) !== value.slice(3)) return false;
        if (value.startsWith('in.(') && !value.slice(4, -1).split(',').includes(r[key]))
          return false;
      }
      return true;
    });
    if (method === 'PATCH') {
      for (const r of selected) {
        Object.assign(r, body);
        if (table === 'auction_records')
          state.history.push(row({ record_id: r.id, action: '결과·복기 수정', after_value: r }));
      }
      return json(req.headers().prefer?.includes('return=representation') ? selected : null);
    }
    return json(selected);
  });
  await page.route('**/api/analyze', async (route) => {
    state.apiCalls++;
    const body = route.request().postDataJSON(),
      id = body.documentIds[0];
    const raw = {
      fields:
        body.mode === 'auction'
          ? {
              court: '서울중앙지방법원',
              caseNumber: '2026타경456',
              itemNumber: '1',
              address: '서울 합성주소 123',
              area: '59.9',
              auctionDate: '2026-10-01',
              appraisal: '2억',
              minimumPrice: '1억 2300만원',
              saleResult: null,
              actualPrice: null,
            }
          : {},
      evidence: [
        {
          field: 'minimumPrice',
          value: '1억 2300만원',
          documentId: id,
          page: 1,
          quote: '최저매각가격 1억 2300만원',
          needsReview: true,
        },
      ],
      tenants:
        body.mode === 'tenancy'
          ? [
              {
                occupant: '합성 임차인',
                unit: '101호',
                deposit: '5000만원',
                monthlyRent: null,
                moveInDate: null,
                fixedDate: null,
                distributionDemandDate: null,
                claim: '자료 확인 필요',
                documentId: id,
                page: 1,
                quote: '합성 자료: 보증금 5000만원',
                needsReview: true,
              },
            ]
          : [],
      transactions:
        body.mode === 'transactions'
          ? [
              {
                price: '2억원',
                contractDate: '2026-09-10',
                floor: '3',
                area: '59.9',
                address: '서울 합성주소 123',
                buildingName: null,
                cancelled: false,
                documentId: id,
                page: 1,
                quote: '59.9㎡ 3층 2억원',
                needsReview: true,
              },
              {
                price: '3억원',
                contractDate: '2026-09-11',
                floor: '5',
                area: '84',
                address: '서울 합성주소 123',
                buildingName: null,
                cancelled: false,
                documentId: id,
                page: 1,
                quote: '84㎡ 5층 3억원',
                needsReview: true,
              },
            ]
          : [],
      warnings: ['합성 테스트 응답입니다. 실제 Google 연결 검증이 아닙니다.'],
    };
    const analysis = {
      id: randomUUID(),
      mode: body.mode,
      result: raw,
      document_ids: body.documentIds,
      created_at: new Date().toISOString(),
    };
    state.analyses.push(analysis);
    await route.fulfill({ json: { analysis } });
  });
  await page.goto('/');
  await page.getByLabel('이메일', { exact: true }).fill('synthetic@example.test');
  await page.getByLabel('비밀번호', { exact: true }).fill('synthetic-password');
  await page.getByRole('button', { name: '로그인', exact: true }).click();
  await expect(page.getByRole('heading', { name: '물건 기록', exact: true })).toBeVisible();
  return state;
}
async function fillNew(page: Page) {
  await page.getByRole('button', { name: '＋ 새 기록 작성', exact: true }).click();
  for (const [key, value] of Object.entries({
    court: '서울중앙지방법원',
    caseNumber: '2026타경123',
    itemNumber: '1',
    auctionDate: '2026-10-01',
    forecastDate: '2026-09-01',
    predictedPrice: '105000000',
    virtualBid: '100000000',
    minimumPrice: '90000000',
    marketPrice: '150000000',
    extraCosts: '10000000',
    targetProfit: '20000000',
  }))
    await page.locator('#' + key).fill(value);
}
async function save(page: Page) {
  await page.getByLabel('결과 확인 전에 작성한 예측입니다.').check();
  await page.getByLabel('원본과 입력값을 대조했습니다.').check();
  await page.getByRole('button', { name: '기록 저장하기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '물건 기록', exact: true })).toBeVisible();
}
test('login, immutable prediction workflow, result metrics, persistence and logout', async ({
  page,
}) => {
  const state = await setup(page);
  await fillNew(page);
  await save(page);
  await expect(page.locator('tbody')).toContainText('2026타경123');
  await page.reload();
  await page.getByRole('button', { name: '상세·분석', exact: true }).click();
  await page.locator('#result_saleResult').selectOption('낙찰');
  await page.locator('#result_actualPrice').fill('100000000');
  await page.getByRole('button', { name: '결과·복기 저장', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('저장했습니다');
  expect(state.records[0].fields.predictedPrice).toBe(105000000);
  await page.getByRole('button', { name: '물건 기록', exact: true }).click();
  await expect(page.locator('.metrics')).toContainText('+5.0%');
  await page.screenshot({ path: 'test-results/records.png', fullPage: true });
  expect(state.googleCalls).toBe(0);
  await page.getByRole('button', { name: '로그아웃', exact: true }).click();
  await expect(page.getByRole('heading', { name: '내 기록장 로그인' })).toBeVisible();
});
test('upload, server-only extraction, human correction, tenancy, area-separated trades and linked simulator', async ({
  page,
}) => {
  const state = await setup(page);
  await fillNew(page);
  await page
    .getByLabel('캡처·PDF 파일')
    .filter({ visible: true })
    .setInputFiles('samples/synthetic-auction.pdf');
  await page.getByRole('button', { name: 'AI로 내용 읽기', exact: true }).click();
  await expect(page.locator('#caseNumber')).toHaveValue('2026타경456');
  await expect(page.locator('#predictedPrice')).toHaveValue('105000000');
  await page.locator('#minimumPrice').fill('90000000');
  await save(page);
  await page.getByRole('button', { name: '상세·분석', exact: true }).click();
  await page.getByRole('button', { name: '점유·임차', exact: true }).click();
  await page
    .getByLabel('캡처·PDF 파일')
    .filter({ visible: true })
    .setInputFiles('samples/synthetic-auction.pdf');
  await page
    .getByRole('combobox', { name: '분석 유형' })
    .filter({ visible: true })
    .selectOption('tenancy');
  await page.getByRole('button', { name: 'AI로 내용 읽기', exact: true }).click();
  await expect(page.getByLabel('점유자·임차인')).toHaveValue('합성 임차인');
  await page.getByLabel('검토·수정 사유').fill('합성 자료 원문 대조');
  await page.getByLabel('원문 근거와 수정값을 확인했습니다.').check();
  await page.getByRole('button', { name: '검토본 저장 (원본 유지)', exact: true }).click();
  await expect.poll(() => state.reviews.length).toBe(1);
  await page.getByRole('button', { name: '실거래가', exact: true }).click();
  await page
    .getByRole('combobox', { name: '분석 유형' })
    .filter({ visible: true })
    .selectOption('transactions');
  await page.getByRole('button', { name: 'AI로 내용 읽기', exact: true }).click();
  await page.getByLabel('이 물건과 연결할 거래임을 주소·건물 기준으로 확인했습니다.').check();
  await page.getByLabel('거래금액·계약일·층·전용면적·취소 여부를 확인했습니다.').check();
  await page.getByRole('button', { name: '확인한 거래 저장', exact: true }).click();
  await expect(page.getByRole('heading', { name: '59.9㎡ · 동일 면적' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '84㎡ · 다른 면적' })).toBeVisible();
  expect(state.trades.length).toBe(2);
  await page.getByRole('button', { name: '수익 시뮬레이터', exact: true }).click();
  await page.getByLabel('일반 법인세 증분 실효세율 (%)').fill('10');
  await page.getByLabel('가정·확인 근거 메모').fill('검토용 합성 가정, 법정세율 판정 아님');
  await page.getByLabel('세율·용도·비용·공제 가정을 확인했습니다.').check();
  await page.getByRole('button', { name: '시뮬레이션 저장', exact: true }).click();
  await expect.poll(() => state.simulations.length).toBe(1);
  expect(state.simulations[0].record_id).toBe(state.records[0].id);
  expect(state.apiCalls).toBe(3);
  expect(state.googleCalls).toBe(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/simulator.png', fullPage: true });
});
test('CSV import preview, duplicate preservation, backup and mobile layouts', async ({ page }) => {
  const state = await setup(page);
  page.on('dialog', (dialog) => dialog.accept());
  const csv =
    '법원,사건번호,물건번호,매각기일,예상 작성일,예상 낙찰가,매각 결과,실제 낙찰가,결과 확인 전 예측\n서울중앙지방법원,2026타경CSV,1,2026-10-01,2026-09-01,105000000,낙찰,100000000,TRUE';
  const input = page.getByLabel('기존 기록 CSV');
  await input.setInputFiles({ name: 'old.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.locator('tbody')).toContainText('2026타경CSV');
  await input.setInputFiles({ name: 'old.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByRole('status')).toContainText('중복 1행');
  expect(state.records.length).toBe(1);
  await page.getByRole('button', { name: '계정·데이터 설정', exact: true }).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '데이터 JSON 백업', exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('madang-metadata-backup.json');
  for (const width of [390, 768, 1560]) {
    await page.setViewportSize({ width, height: 950 });
    for (const name of ['물건 기록', '＋ 새 기록 작성', '계정·데이터 설정', '사용 안내']) {
      await page.getByRole('button', { name, exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    }
  }
  await page.setViewportSize({ width: 390, height: 950 });
  await page.getByRole('button', { name: '물건 기록', exact: true }).click();
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
});
test('AI service failure preserves input and originals without an automatic retry', async ({
  page,
}) => {
  const state = await setup(page);
  let calls = 0;
  await page.route('**/api/analyze', async (route) => {
    calls++;
    await route.fulfill({
      status: 503,
      json: { error: 'Gemini HTTP 503 · 혼잡. 자동 재시도하지 않았습니다.' },
    });
  });
  await fillNew(page);
  await page
    .getByLabel('캡처·PDF 파일')
    .filter({ visible: true })
    .setInputFiles('samples/synthetic-auction.pdf');
  await page.getByRole('button', { name: 'AI로 내용 읽기', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('503');
  await expect(page.locator('#predictedPrice')).toHaveValue('105000000');
  await expect(page.locator('#court')).toHaveValue('서울중앙지방법원');
  await expect(page.getByRole('button', { name: 'AI로 내용 읽기', exact: true })).toBeEnabled();
  expect(calls).toBe(1);
  expect(state.documents).toHaveLength(1);
  expect(state.googleCalls).toBe(0);
});
