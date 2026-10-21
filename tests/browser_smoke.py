"""Actual Chromium UI + real Apps Script logic; Google/Gemini services are test doubles."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from urllib.request import urlopen
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]


class BrowserWorkflow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = subprocess.Popen(['node','tests/fixtures/browser_server.cjs'],cwd=ROOT,stdout=subprocess.PIPE,text=True)
        cls.base = 'http://127.0.0.1:' + str(json.loads(cls.server.stdout.readline())['port'])
        cls.playwright = sync_playwright().start()
        executable = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('google-chrome')
        cls.browser = cls.playwright.chromium.launch(**({'executable_path':executable} if executable else {}),headless=True,args=['--no-sandbox'])
        cls.artifacts = Path(tempfile.mkdtemp(prefix='madang-browser-'))

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.terminate()
        cls.server.wait(timeout=10)
        cls.server.stdout.close()
        print('Browser validation artifacts:',cls.artifacts)

    def new_page(self,width=1440):
        page = self.browser.new_page(viewport={'width':width,'height':1000},timezone_id='Asia/Seoul')
        page.add_init_script("const RealDate=Date; window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:['2026-10-22T03:00:00Z']));}static now(){return new RealDate('2026-10-22T03:00:00Z').getTime();}};")
        return page

    def inspect(self):
        with urlopen(self.base+'/inspect') as result:
            return json.load(result)

    def test_01_upload_review_save_update_and_duplicate(self):
        page = self.new_page()
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(self.base)
        expect(page.locator('#setupButton')).to_be_visible()
        page.locator('#setupButton').click()
        expect(page.locator('#connection')).to_contain_text('연결됨')
        # Personal predictions entered before extraction must survive the AI response.
        page.locator('#predictedPrice').fill('105000000')
        page.locator('#virtualBid').fill('95000000')
        # Valid synthetic PNG and a real Chromium-generated PDF (no personal documents).
        fixture_page=self.browser.new_page()
        fixture_page.set_content('<h1>SYNTHETIC AUCTION DOCUMENT</h1><p>2026 test case, not a real property.</p>')
        pdf=fixture_page.pdf()
        png=fixture_page.screenshot()
        fixture_page.close()
        page.locator('#fileInput').set_input_files([
            {'name':'법원 화면.png','mimeType':'image/png','buffer':png},
            {'name':'매각물건명세서.pdf','mimeType':'application/pdf','buffer':pdf},
        ])
        expect(page.locator('#extractButton')).to_be_enabled()
        page.locator('#extractButton').click()
        expect(page.locator('#court')).to_have_value('서울중앙지방법원')
        expect(page.locator('#predictedPrice')).to_have_value('105000000')
        expect(page.locator('#virtualBid')).to_have_value('95000000')
        expect(page.locator('#propertyType')).to_have_value('근린시설')
        expect(page.locator('#minimumPrice')).to_have_value('1억 2300만원')
        assert 'needs-review' in page.locator('#minimumPrice').locator('..').get_attribute('class')
        page.locator('#minimumPrice').fill('90000000')
        page.locator('#marketPrice').locator('xpath=ancestor::details').locator('summary').click()
        page.locator('#marketPrice').fill('150000000')
        page.locator('#extraCosts').fill('10000000')
        page.locator('#targetProfit').fill('20000000')
        # Above fields may be in collapsed details: programmatically open their parent.
        page.screenshot(path=str(self.artifacts/'desktop.png'),full_page=True)
        page.locator('#reviewed').check()
        page.locator('#beforeResult').check()
        page.locator('#archiveDocuments').check()
        page.locator('#saveButton').click()
        expect(page.locator('#saveMessage')).to_contain_text('저장했습니다')
        expect(page.locator('#recordsBody')).to_contain_text('2026타경123')
        data=self.inspect()
        assert data['archived']==2
        record=data['state']['records'][0]
        assert record['predictedPrice']==105000000
        assert record['minimumPrice']==90000000
        assert record['upperLimit']==120000000
        assert len(record['sourceDocuments'])==2
        assert '1억 2300만원' in data['audit'][2][3]
        assert '90000000' in data['audit'][2][4]
        page.get_by_role('button',name='결과·복기',exact=True).click()
        page.locator('#update_saleResult').select_option('낙찰')
        page.locator('#update_actualPrice').fill('100000000')
        page.locator('#update_bidderCount').fill('7')
        page.locator('#update_reviewNote').fill('합성 결과로 5% 경계를 검증')
        page.locator('#updateResultButton').click()
        expect(page.locator('#resultDialog')).not_to_be_visible()
        expect(page.locator('#metricAbsolute')).to_have_text('5.0%')
        expect(page.locator('#metricCount')).to_have_text('1 건')
        assert self.inspect()['state']['records'][0]['predictedPrice']==105000000
        page.locator('#newRecordButton').click()
        for key,value in {'court':'서울중앙지방법원','caseNumber':'2026타경123','itemNumber':'1','auctionDate':'2026-11-10'}.items():
            page.locator('#'+key).fill(value)
        page.locator('#reviewed').check()
        page.locator('#saveButton').click()
        expect(page.locator('#saveMessage')).to_contain_text('이미 있습니다')
        assert len(self.inspect()['state']['records'])==1
        assert not errors,errors
        page.close()

    def test_02_sidebar_layout(self):
        for width in [320,390,1440]:
            page=self.new_page(width)
            errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(self.base)
            expect(page.locator('#connection')).to_contain_text('연결됨')
            # Only the records table scrolls horizontally, not the page.
            self.assertTrue(page.evaluate('document.documentElement.scrollWidth <= innerWidth'),str(width))
            page.screenshot(path=str(self.artifacts/f'layout-{width}.png'),full_page=True)
            self.assertFalse(errors)
            page.close()

    def test_03_key_registration_and_explicit_live_vs_simulated_diagnostics(self):
        page=self.new_page()
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(self.base)
        expect(page.locator('#connection')).to_contain_text('연결됨')
        before=self.inspect()
        page.locator('#connectionSetup summary').click()
        page.locator('#apiKeyInput').fill('browser-fixture-not-a-real-key')
        page.locator('#storeApiKey').click()
        expect(page.locator('#diagnosticMessage')).to_contain_text('키를 저장했습니다')
        expect(page.locator('#apiKeyInput')).to_have_value('')
        assert 'browser-fixture-not-a-real-key' not in page.locator('body').inner_text()
        page.locator('#simulatedCheck').click()
        expect(page.locator('#diagnosticMessage')).to_contain_text('[모의 점검]')
        expect(page.locator('#diagnosticChecks li')).to_have_count(7)
        page.locator('#checkApi').click()
        expect(page.locator('#diagnosticMessage')).to_contain_text('[실제 API]')
        expect(page.locator('#diagnosticMessage')).to_contain_text('점검 응답을 확인')
        page.locator('#liveSample').click()
        expect(page.locator('#diagnosticChecks li')).to_have_count(5)
        expect(page.locator('#diagnosticMessage')).to_contain_text('[실제 API]')
        self.assertNotIn('error',page.locator('#diagnosticMessage').get_attribute('class'))
        after=self.inspect()
        self.assertEqual(len(before['state']['records']),len(after['state']['records']))
        self.assertEqual(before['archived'],after['archived'])
        self.assertEqual(len(before['audit']),len(after['audit']))
        page.screenshot(path=str(self.artifacts/'connection-diagnostics.png'),full_page=True)
        self.assertFalse(errors)
        page.close()


if __name__=='__main__':
    unittest.main(verbosity=2)
