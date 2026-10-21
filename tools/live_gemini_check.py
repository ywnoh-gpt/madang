"""Opt-in live Gemini/PDF check using synthetic data and a redacted JSON report.

Supply GEMINI_API_KEY through the process environment or use --prompt-key. This
program never accepts a key argument, prints a key, or saves a key in its report.
--dry-run validates the local fixture/request only; it does not call Gemini.
"""
from __future__ import annotations

import argparse
import base64
from datetime import datetime, timezone
import getpass
import json
import os
from pathlib import Path
import re
import tempfile
import urllib.error
import urllib.request


DEFAULT_MODEL = "gemini-flash-latest"
EXPECTED = {
    "court": "SEOUL",
    "caseNumber": "2026-TEST-42",
    "itemNumber": "1",
    "auctionDate": "2030-10-22",
    "appraisal": "200000000",
    "minimumPrice": "140000000",
}
REPORT_DEFAULT = Path("/tmp/madang-live-report.json")


def synthetic_pdf() -> bytes:
    """Return a valid one-page PDF with synthetic, non-personal auction facts."""
    lines = ["SYNTHETIC AUCTION FIXTURE - NOT A REAL PROPERTY"]
    lines.extend(f"{key}: {value}" for key, value in EXPECTED.items())
    stream = b"BT /F1 11 Tf 48 760 Td 16 TL\n"
    for index, text in enumerate(lines):
        escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        if index:
            stream += b"T*\n"
        stream += b"(" + escaped.encode("ascii") + b") Tj\n"
    stream += b"ET\n"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode("ascii") + b" >>\nstream\n" + stream + b"endstream",
    ]
    document = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for number, content in enumerate(objects, 1):
        offsets.append(len(document))
        document.extend(f"{number} 0 obj\n".encode("ascii") + content + b"\nendobj\n")
    xref = len(document)
    document.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode("ascii"))
    for offset in offsets[1:]:
        document.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    document.extend(
        f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode("ascii")
    )
    return bytes(document)


def request_payload(pdf: bytes) -> dict:
    return {
        "contents": [{"role": "user", "parts": [
            {"text": "Read only the six labeled fields in this synthetic auction PDF. "
             "Return exact visible strings, including the ASCII court label and case number. "
             "Keep monetary values as integer-won strings without punctuation. "
             "Return null for a field that cannot be read. Do not invent any other values."},
            {"inlineData": {"mimeType": "application/pdf", "data": base64.b64encode(pdf).decode("ascii")}},
        ]}],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "application/json",
            "responseSchema": {
                "type": "OBJECT",
                "properties": {key: {"type": "STRING", "nullable": True} for key in EXPECTED},
                "required": list(EXPECTED),
            },
        },
    }


class _RejectRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        # Never forward the credential header to a redirect destination.
        raise urllib.error.URLError("Redirect rejected")


def _open(request, timeout):
    # urllib keeps the platform's HTTPS certificate verification and proxy setup.
    return urllib.request.build_opener(_RejectRedirects()).open(request, timeout=timeout)


def run_check(*, key: str | None, model: str = DEFAULT_MODEL, dry_run: bool = False, timeout: int = 60) -> tuple[dict, int]:
    report = {
        "checkedAt": datetime.now(timezone.utc).isoformat(),
        "mode": "dry_run" if dry_run else "live",
        "status": "live_fail",
        "liveRequestAttempted": False,
        "fixture": "synthetic-auction-pdf-v1",
    }
    if not re.fullmatch(r"[A-Za-z0-9._-]+", model):
        report.update(reason="invalid_model_id", message="Use a Gemini model ID, not a URL or credential.")
        return report, 1
    report["model"] = model
    pdf = synthetic_pdf()
    payload = request_payload(pdf)
    if not pdf.startswith(b"%PDF-") or not pdf.endswith(b"%%EOF\n"):
        report.update(reason="invalid_local_fixture", message="Synthetic PDF validation failed.")
        return report, 1
    report["fixtureBytes"] = len(pdf)
    report["expectedFields"] = list(EXPECTED)
    if dry_run:
        report.update(status="dry_run_pass", message="Local PDF and request schema validated. No API call or credential registration was performed.")
        return report, 0
    if not key or not key.strip():
        report.update(status="missing_key", reason="missing_key", message="Set GEMINI_API_KEY securely or use --prompt-key. No API call was made.")
        return report, 2
    request = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": key.strip()},
        method="POST",
    )
    report["liveRequestAttempted"] = True
    try:
        with _open(request, timeout) as response:
            body = response.read(2 * 1024 * 1024)
            report["httpStatus"] = response.status
    except urllib.error.HTTPError as error:
        report["httpStatus"] = error.code
        # Recognize the managed proxy's explicit policy denial without retaining
        # or printing the response body (which can contain arbitrary details).
        body = error.read(4096).lower()
        if error.code == 403 and b"domain forbidden" in body:
            report.update(status="network_blocked", reason="egress_policy", message="The network proxy explicitly denied this destination. No successful Gemini call was verified.")
        else:
            report.update(reason="http_error", message="Gemini request failed. Check the API key, model access, quota and network settings.")
        return report, 1
    except (urllib.error.URLError, TimeoutError, OSError):
        report.update(reason="network_error", message="Network or TLS request failed. No successful Gemini call was verified.")
        return report, 1
    try:
        parsed = json.loads(body)
        candidate = parsed["candidates"][0]
        extracted_text = "".join(part.get("text", "") for part in candidate["content"]["parts"])
        fields = json.loads(extracted_text)
        if not isinstance(fields, dict):
            raise ValueError("Expected object")
    except (KeyError, IndexError, TypeError, ValueError, AttributeError):
        report.update(reason="invalid_response", message="The API responded, but a complete structured extraction could not be read.")
        return report, 1
    mismatches = [field for field, expected in EXPECTED.items() if fields.get(field) != expected]
    if mismatches:
        report.update(reason="field_mismatch", mismatchedFields=mismatches, message="The synthetic PDF was processed, but some extracted fields did not match. Review the model output in the authorized application.")
        return report, 1
    report.update(status="live_pass", message="Gemini read the synthetic PDF and all six fields matched. This does not verify Google Sheets authorization or real-document accuracy.")
    return report, 0


def write_report(report: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, prefix=".madang-report-", delete=False) as temp:
            temp_path = Path(temp.name)
            json.dump(report, temp, ensure_ascii=False, indent=2)
            temp.write("\n")
        temp_path.replace(path)
    finally:
        if temp_path and temp_path.exists():
            temp_path.unlink()


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Validate the synthetic PDF/request locally; do not call Gemini.")
    parser.add_argument("--prompt-key", action="store_true", help="Read a key without echoing it instead of using GEMINI_API_KEY.")
    parser.add_argument("--model", default=os.environ.get("GEMINI_MODEL", DEFAULT_MODEL))
    parser.add_argument("--report", type=Path, default=REPORT_DEFAULT)
    parser.add_argument("--pdf-output", type=Path, help="Optionally save the synthetic, non-personal PDF fixture.")
    args = parser.parse_args(argv)
    if args.pdf_output:
        args.pdf_output.parent.mkdir(parents=True, exist_ok=True)
        args.pdf_output.write_bytes(synthetic_pdf())
    key = None if args.dry_run else (getpass.getpass("Gemini API key (hidden): ") if args.prompt_key else os.environ.get("GEMINI_API_KEY"))
    report, code = run_check(key=key, model=args.model, dry_run=args.dry_run)
    write_report(report, args.report)
    print(json.dumps({"status": report["status"], "mode": report["mode"], "report": str(args.report)}, ensure_ascii=False))
    return code


if __name__ == "__main__":
    raise SystemExit(main())
