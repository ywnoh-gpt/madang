"""Standalone HTML in real Chromium/IndexedDB; Gemini is intercepted, never claimed live."""
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import shutil
import tempfile
import threading
import unittest
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class StandaloneJournal(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = 'http://127.0.0.1:' + str(cls.server.server_port)
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(executable_path=shutil.which('chromium'), headless=True, args=['--no-sandbox'])
        cls.artifacts = Path(tempfile.mkdtemp(prefix='madang-html-browser-'))

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        cls.server.shutdown()
        cls.server.server_close()
        print('Standalone screenshots and backups:', cls.artifacts)

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width': 1560, 'height': 1050}, accept_downloads=True, timezone_id='Asia/Seoul')
        self.page = self.context.new_page()
        self.errors = []
        self.page.on('pageerror', lambda e: self.errors.append(str(e)))
        self.page.goto(self.url)
        expect(self.page.locator('#metricCount')).to_have_text('0건')

    def tearDown(self):
        assert not self.errors, self.errors
        self.context.close()

    def fill_manual(self, item='1', **patch):
        self.page.locator('.nav[data-view="editor"]').click()
        fields = {'court': '서울중앙지방법원', 'caseNumber': '2026타경123', 'itemNumber': item, 'auctionDate': '2026-10-01', 'forecastDate': '2026-09-20', 'address': '서울특별시 중구 합성주소 123', 'minimumPrice': '90000000', 'predictedPrice': '105000000', 'virtualBid': '100000000', 'marketPrice': '150000000', 'extraCosts': '10000000', 'targetProfit': '20000000'}
        fields.update(patch)
        for key, value in fields.items():
            self.page.locator('#'+key).fill(value)

    def save_manual(self, item='1'):
        self.fill_manual(item)
        self.page.locator('#beforeResult').check()
        self.page.locator('#reviewed').check()
        self.page.locator('#saveButton').click()
        expect(self.page.locator('#globalMessage')).to_contain_text('기록을 저장했습니다')

    def test_01_persistence_result_metrics_duplicate_and_backup_restore(self):
        page = self.page
        self.save_manual()
        page.reload()
        expect(page.locator('#recordsBody')).to_contain_text('2026타경123')
        page.get_by_role('button', name='상세·복기').click()
        expect(page.locator('#detailContent')).to_contain_text('120,000,000원')
        page.locator('#update_saleResult').select_option('낙찰')
        page.locator('#update_actualPrice').fill('100000000')
        page.locator('#update_bidderCount').fill('7')
        page.locator('#update_reviewNote').fill('동액 입찰은 낙찰 여부를 확정할 수 없다.')
        page.locator('#updateResultButton').click()
        expect(page.locator('#metricAbsolute')).to_have_text('5.0%')
        expect(page.locator('#metricRatio')).to_have_text('평가 기록의 100.0%')
        expect(page.locator('#metricCount')).to_have_text('1건')
        self.fill_manual()
        page.locator('#reviewed').check()
        page.locator('#saveButton').click()
        expect(page.locator('#saveMessage')).to_contain_text('이미 있습니다')
        page.locator('.nav[data-view="records"]').click()
        with page.expect_download() as info:
            page.locator('#backupButton').click()
        backup_path = self.artifacts/'test-backup.json'
        info.value.save_as(backup_path)
        backup = json.loads(backup_path.read_text())
        assert len(backup['records']) == 1
        assert len(backup['history']) == 2
        assert backup['records'][0]['predictedPrice'] == 105000000
        update = next(h for h in backup['history'] if h['action'] == '결과·복기 수정')
        assert update['before']['actualPrice'] is None
        # Restore into a fresh browser profile: real IndexedDB starts empty.
        other = self.browser.new_context(accept_downloads=True)
        restored = other.new_page()
        restored.goto(self.url)
        expect(restored.locator('#metricCount')).to_have_text('0건')
        restored.on('dialog', lambda dialog: dialog.accept())
        restored.locator('#importFile').set_input_files(str(backup_path))
        expect(restored.locator('#globalMessage')).to_contain_text('1건을 가져왔습니다')
        expect(restored.locator('#metricAbsolute')).to_have_text('5.0%')
        restored.locator('#importFile').set_input_files(str(backup_path))
        expect(restored.locator('#globalMessage')).to_contain_text('기존 기록 1건')
        other.close()
        page.screenshot(path=str(self.artifacts/'records-desktop.png'), full_page=True)

    def test_02_upload_extract_correct_save_and_session_key_not_persisted(self):
        page = self.page
        calls = []
        fields = {'court': '서울중앙지방법원', 'caseNumber': '2026타경456', 'itemNumber': '2', 'auctionDate': '2026-11-20', 'appraisal': 'KRW 200,000,000', 'minimumPrice': '1억 2300만원', 'saleResult': None, 'actualPrice': None}
        raw = {'fields': fields, 'confidence': {k: 'low' if k == 'minimumPrice' else 'high' for k in fields}, 'warnings': ['최저가 원본을 확인하세요.']}
        def gemini(route):
            calls.append(route.request)
            route.fulfill(json={'candidates': [{'finishReason': 'STOP', 'content': {'parts': [{'text': json.dumps(raw)}]}}]})
        page.route('https://generativelanguage.googleapis.com/**', gemini)
        page.locator('.nav[data-view="settings"]').click()
        page.locator('#apiKey').fill('synthetic-secret-never-store')
        self.fill_manual('2', auctionDate='2026-11-20', forecastDate='2026-10-01')
        with page.expect_event('framenavigated', predicate=lambda frame: frame.url.startswith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/')) as viewer_event:
            page.locator('#fileInput').set_input_files([{'name': 'synthetic.pdf', 'mimeType': 'application/pdf', 'buffer': (ROOT/'samples/synthetic-auction.pdf').read_bytes()}])
        expect(page.locator('#extractButton')).to_be_enabled()
        # Chromium's native PDF viewer must load, rather than a sandbox/plugin error.
        # evaluate the function directly: wait_for_function injects eval, which
        # Chromium correctly forbids in its own PDF extension's CSP.
        viewer_event.value.evaluate('''async () => {
          await customElements.whenDefined('pdf-viewer');
          for (let i=0;i<200;i++) {
            if(document.querySelector('pdf-viewer').initialLoadComplete_) return;
            await new Promise(resolve=>setTimeout(resolve,25));
          }
          throw new Error('Native PDF viewer did not finish loading');
        }''')
        page.locator('#extractButton').click()
        expect(page.locator('#court')).to_have_value('서울중앙지방법원')
        expect(page.locator('#caseNumber')).to_have_value('2026타경456')
        expect(page.locator('#predictedPrice')).to_have_value('105000000')
        expect(page.locator('#minimumPrice')).to_have_value('1억 2300만원')
        assert 'needs-review' in page.locator('#minimumPrice').locator('..').get_attribute('class')
        page.locator('#minimumPrice').fill('90000000')
        page.locator('#correctionReason').fill('합성 PDF 오독 수정')
        page.evaluate('window.scrollTo(0,0)')
        page.screenshot(path=str(self.artifacts/'editor-desktop.png'))
        page.locator('#beforeResult').check()
        page.locator('#reviewed').check()
        page.locator('#saveButton').click()
        expect(page.locator('#recordsBody')).to_contain_text('2026타경456')
        data = page.evaluate('MadangStore.backup()')
        record = data['records'][0]
        assert record['minimumPrice'] == 90000000
        assert record['extraction']['fields']['minimumPrice'] == '1억 2300만원'
        assert record['sources'][0]['dataUrl'].startswith('data:application/pdf;base64,')
        assert 'dataUrl' not in data['history'][0]['after']['sources'][0]
        assert 'synthetic-secret-never-store' not in json.dumps(data)
        assert len(calls) == 1
        assert 'key=' not in calls[0].url
        assert calls[0].headers['x-goog-api-key'] == 'synthetic-secret-never-store'
        page.reload()
        page.locator('.nav[data-view="settings"]').click()
        expect(page.locator('#apiKey')).to_have_value('')

    def test_03_draft_reload_pdf_failure_invalid_file_and_safe_rendering(self):
        page = self.page
        self.fill_manual(address='<img src=x onerror="alert(1)">')
        expect(page.locator('#draftStatus')).to_have_text('이 브라우저에 임시 저장됨')
        page.on('dialog', lambda dialog: dialog.accept())
        page.reload()
        page.locator('.nav[data-view="editor"]').click()
        expect(page.locator('#address')).to_have_value('<img src=x onerror="alert(1)">')
        expect(page.locator('#reviewed')).not_to_be_checked()
        page.locator('#fileInput').set_input_files([{'name': 'fake.pdf', 'mimeType': 'application/pdf', 'buffer': b'not-a-pdf'}])
        expect(page.locator('#extractMessage')).to_contain_text('PNG·JPEG·WebP')
        expect(page.locator('#address')).to_have_value('<img src=x onerror="alert(1)">')
        page.locator('#reviewed').check()
        page.locator('#saveButton').click()
        expect(page.locator('#recordsBody')).to_contain_text('<img src=x onerror="alert(1)">')
        assert page.locator('#recordsBody img').count() == 0

    def test_04_layout_mobile_and_no_network_until_explicit_ai(self):
        page = self.page
        requests = []
        page.on('request', lambda request: requests.append(request.url))
        for width in [390, 768, 1560]:
            page.set_viewport_size({'width': width, 'height': 950})
            for view in ['records', 'editor', 'settings', 'guide']:
                page.locator('.nav[data-view="'+view+'"]').click()
                assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), (width, view)
            if width == 390:
                page.locator('.nav[data-view="records"]').click()
                page.screenshot(path=str(self.artifacts/'records-mobile.png'), full_page=True)
        assert not any('google' in url for url in requests)

    def test_05_api_503_retains_input_and_has_no_retry(self):
        page = self.page
        calls = []
        def unavailable(route):
            calls.append(route.request)
            route.fulfill(status=503, json={'error': {'message': 'busy synthetic-key'}})
        page.route('https://generativelanguage.googleapis.com/**', unavailable)
        page.locator('.nav[data-view="settings"]').click()
        page.locator('#apiKey').fill('synthetic-key')
        page.locator('#checkApi').click()
        expect(page.locator('#apiMessage')).to_contain_text('503')
        expect(page.locator('#apiMessage')).not_to_contain_text('synthetic-key')
        assert len(calls) == 1
        expect(page.locator('#checkApi')).to_be_enabled()

    def test_06_csv_migration_conflict_rollback_and_next_round(self):
        page = self.page
        page.on('dialog', lambda dialog: dialog.accept())
        csv = 'madang-journal-v1,,,,,,,,\n법원,사건번호,물건번호,매각기일,예상 작성일,예상 낙찰가,매각 결과,실제 낙찰가,결과 확인 전 예측\n서울중앙지방법원,2026타경789,1,2026-10-01,2026-09-20,105000000,낙찰,100000000,TRUE'
        page.locator('#importFile').set_input_files({'name': 'old-sheet.csv', 'mimeType': 'text/csv', 'buffer': csv.encode()})
        expect(page.locator('#metricAbsolute')).to_have_text('5.0%')
        backup = page.evaluate('MadangStore.backup()')
        original = backup['records'][0]
        new = dict(original, recordId='new-safe-record', caseNumber='2026타경NEW')
        changed = dict(original, predictedPrice=1)
        backup['records'] = [new, changed]
        page.locator('#importFile').set_input_files({'name': 'conflict.json', 'mimeType': 'application/json', 'buffer': json.dumps(backup).encode()})
        expect(page.locator('#globalMessage')).to_contain_text('덮어쓰지 않았습니다')
        assert len(page.evaluate('MadangStore.records()')) == 1
        page.get_by_role('button', name='상세·복기').click()
        page.locator('#nextRound').click()
        expect(page.locator('#auctionDate')).to_have_value('')
        expect(page.locator('#predictedPrice')).to_have_value('')
        expect(page.locator('#caseNumber')).to_have_value('2026타경789')
        expect(page.locator('#saleResult')).to_have_value('미확인')

    def test_07_atomic_duplicates_across_tabs_and_immutable_forecasts(self):
        page = self.page
        other = self.context.new_page()
        other.goto(self.url)
        expect(other.locator('#metricCount')).to_have_text('0건')
        fields = {'court': '서울중앙지방법원', 'caseNumber': '2026타경RACE', 'itemNumber': '1', 'auctionDate': '2026-11-20', 'predictedPrice': 100000000}
        # Start two writes without waiting, as two browser tabs can do.
        result = page.evaluate('''async fields => {
          const outcomes = await Promise.allSettled([
            MadangStore.save(fields, null, []), MadangStore.save(fields, null, [])
          ]);
          return outcomes.map(o => ({status:o.status,reason:o.reason?.message}));
        }''', fields)
        assert [o['status'] for o in result].count('fulfilled') == 1
        assert '이미 있습니다' in next(o['reason'] for o in result if o['status'] == 'rejected')
        records = page.evaluate('MadangStore.records()')
        assert len(records) == 1
        assert len(other.evaluate('MadangStore.records()')) == 1
        duplicate = other.evaluate('''async fields => {
          try { await MadangStore.save(fields,null,[]);return false; }
          catch(error) {return error.message;}
        }''', fields)
        assert '이미 있습니다' in duplicate
        denied = page.evaluate('''async id => {
          try { await MadangStore.updateResult(id,{predictedPrice:1});return false; }
          catch(error) {return error.message;}
        }''', records[0]['recordId'])
        assert '최초 예측' in denied
        assert page.evaluate('MadangStore.records()')[0]['predictedPrice'] == 100000000
        assert len(page.evaluate('MadangStore.history()')) == 1
        other.close()

    def test_08_import_rejects_active_mime_or_mislabeled_original(self):
        page = self.page
        self.save_manual()
        backup = page.evaluate('MadangStore.backup()')
        record = dict(backup['records'][0], recordId='bad-source', caseNumber='2026타경BAD')
        for source in [
            {'name': 'unsafe.pdf', 'mimeType': 'text/html', 'dataUrl': 'data:application/pdf;base64,PGh0bWw+'},
            {'name': 'fake.pdf', 'mimeType': 'application/pdf', 'dataUrl': 'data:application/pdf;base64,PGh0bWw+'},
        ]:
            record['sources'] = [source]
            rejected = page.evaluate('''async record => {
              try { await MadangStore.merge({format:'madang-html-journal',version:1,records:[record],history:[]});return false; }
              catch(error) {return error.message;}
            }''', record)
            assert '백업의 원본' in rejected
        assert len(page.evaluate('MadangStore.records()')) == 1


if __name__ == '__main__':
    unittest.main(verbosity=2)
