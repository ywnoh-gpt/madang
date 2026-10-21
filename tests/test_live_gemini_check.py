import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools import live_gemini_check as check


class Response:
    status = 200

    def __init__(self, fields=None, body=None):
        fields = check.EXPECTED if fields is None else fields
        self.body = json.dumps(body if body is not None else {"candidates": [{"content": {"parts": [{"text": json.dumps(fields)}]}}]}).encode()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        pass

    def read(self, *_):
        return self.body


class LiveGeminiCheckTest(unittest.TestCase):
    def test_pdf_cross_reference_points_to_objects_and_schema_contains_only_facts(self):
        pdf = check.synthetic_pdf()
        self.assertTrue(pdf.startswith(b"%PDF-1.4"))
        xref = int(pdf.split(b"startxref\n")[1].splitlines()[0])
        self.assertEqual(pdf[xref:xref + 4], b"xref")
        entries = pdf[xref:].splitlines()[3:8]
        for index, line in enumerate(entries, 1):
            offset = int(line[:10])
            self.assertTrue(pdf[offset:].startswith(f"{index} 0 obj".encode()))
        schema = check.request_payload(pdf)["generationConfig"]["responseSchema"]
        self.assertEqual(set(schema["properties"]), set(check.EXPECTED))
        self.assertNotIn("predictedPrice", schema["properties"])

    @patch.object(check, "_open")
    def test_dry_run_and_missing_key_never_make_live_requests(self, opened):
        dry, code = check.run_check(key=None, dry_run=True)
        self.assertEqual((dry["status"], code), ("dry_run_pass", 0))
        self.assertFalse(dry["liveRequestAttempted"])
        missing, code = check.run_check(key=None)
        self.assertEqual((missing["status"], code), ("missing_key", 2))
        self.assertFalse(missing["liveRequestAttempted"])
        opened.assert_not_called()

    @patch.object(check, "_open", return_value=Response())
    def test_live_success_sends_credential_header_only_and_redacts_report(self, opened):
        # A dummy test string only. No real credentials are used in tests.
        report, code = check.run_check(key="fixture-credential-not-real")
        self.assertEqual((report["status"], code), ("live_pass", 0))
        request = opened.call_args.args[0]
        self.assertEqual(request.get_header("X-goog-api-key"), "fixture-credential-not-real")
        self.assertNotIn("fixture-credential-not-real", request.full_url)
        self.assertEqual(request.full_url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent")
        self.assertNotIn("fixture-credential-not-real", json.dumps(report))
        self.assertTrue(report["liveRequestAttempted"])

    @patch.object(check, "_open", return_value=Response({**check.EXPECTED, "minimumPrice": "1"}))
    def test_incorrect_extraction_is_a_failure_not_an_assumed_live_success(self, opened):
        report, code = check.run_check(key="fixture")
        self.assertEqual(code, 1)
        self.assertEqual(report["status"], "live_fail")
        self.assertEqual(report["mismatchedFields"], ["minimumPrice"])

    @patch.object(check, "_open", return_value=Response(body={"candidates": []}))
    def test_incomplete_api_response_is_explicit(self, opened):
        report, code = check.run_check(key="fixture")
        self.assertEqual(code, 1)
        self.assertEqual(report["reason"], "invalid_response")

    @patch.object(check, "_open")
    def test_network_policy_denial_is_distinct_and_error_body_is_not_saved(self, opened):
        opened.side_effect = urllib.error.HTTPError("https://generativelanguage.googleapis.com", 403, "Forbidden", {}, io.BytesIO(b"Domain forbidden; private diagnostic details"))
        report, code = check.run_check(key="fixture")
        self.assertEqual((report["status"], code), ("network_blocked", 1))
        self.assertEqual(report["httpStatus"], 403)
        self.assertNotIn("private diagnostic", json.dumps(report))
        opened.side_effect = urllib.error.HTTPError("https://generativelanguage.googleapis.com", 429, "Limit", {}, io.BytesIO(b"confidential response body"))
        report, code = check.run_check(key="fixture")
        self.assertEqual((report["status"], report["reason"], code), ("live_fail", "http_error", 1))
        self.assertNotIn("confidential response", json.dumps(report))

    @patch.object(check, "_open", side_effect=urllib.error.URLError("private network details"))
    def test_tls_or_unknown_network_errors_are_not_claimed_as_policy_denials(self, opened):
        report, code = check.run_check(key="fixture")
        self.assertEqual((report["status"], report["reason"], code), ("live_fail", "network_error", 1))
        self.assertNotIn("private network", json.dumps(report))

    @patch.object(check, "_open")
    def test_invalid_model_never_changes_destination_or_sends_request(self, opened):
        report, code = check.run_check(key="fixture", model="https://example.com/anything")
        self.assertEqual(code, 1)
        self.assertEqual(report["reason"], "invalid_model_id")
        self.assertNotIn("model", report)
        opened.assert_not_called()

    def test_cli_dry_run_writes_sanitized_report_and_optional_pdf(self):
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory) / "report.json"
            pdf = Path(directory) / "fixture.pdf"
            with contextlib.redirect_stdout(io.StringIO()) as output:
                code = check.main(["--dry-run", "--report", str(report), "--pdf-output", str(pdf)])
            self.assertEqual(code, 0)
            self.assertEqual(json.loads(report.read_text())["status"], "dry_run_pass")
            self.assertEqual(json.loads(output.getvalue())["mode"], "dry_run")
            self.assertTrue(pdf.read_bytes().startswith(b"%PDF-"))

    def test_redirects_are_rejected_before_credential_can_be_forwarded(self):
        with self.assertRaises(urllib.error.URLError):
            check._RejectRedirects().redirect_request(None, None, 302, "moved", {}, "https://example.com")


if __name__ == "__main__":
    unittest.main()
