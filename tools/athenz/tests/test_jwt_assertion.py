import base64
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


TOOLS = Path(__file__).resolve().parents[2]
INPUT = "fixture-input-not-a-real-token"
ISSUED_HEADER = {"alg": "RS256", "typ": "at+jwt", "kid": "fixture"}
ISSUED_CLAIMS = {"iss": "fixture-zts", "aud": "api", "scope": "docs-getter"}
# Synthetic JWT with no valid signature, never accepted by a real server.
ISSUED = ".".join(
    base64.urlsafe_b64encode(json.dumps(part).encode()).decode().rstrip("=")
    for part in (ISSUED_HEADER, ISSUED_CLAIMS)
) + ".not-a-signature"
ERROR = "Invalid client assertion: audience api does not identify the token endpoint"
MOCK_CURL = r'''
import json
from pathlib import Path
import sys

root = Path(__file__).parent
args = sys.argv[1:]
data = sys.stdin.read()
with (root / "calls.jsonl").open("a") as log:
    log.write(json.dumps({"args": args, "stdin": data}) + "\n")
fixture = json.loads((root / "response.json").read_text())
if fixture.get("curl_exit"):
    sys.exit(fixture["curl_exit"])
body = fixture["body"]
print(body if isinstance(body, str) else json.dumps(body))
print(fixture["status"], end="")
'''
MOCK_OPENSSL = r'''
import base64
import json
from pathlib import Path
import sys

root = Path(__file__).parent
args = sys.argv[1:]
with (root / "openssl-calls.jsonl").open("a") as log:
    log.write(json.dumps(args) + "\n")
if args[0] == "rsa":
    # Accept the empty placeholder without reading a key.
    sys.exit(0)
elif args[0] == "base64":
    sys.stdout.buffer.write(base64.b64encode(sys.stdin.buffer.read()))
elif args[0] == "dgst":
    # No cryptographic signing; this signature is deliberately invalid.
    sys.stdin.buffer.read()
    sys.stdout.buffer.write(b"fixture-not-a-signature")
else:
    sys.exit(2)
'''


@unittest.skipUnless(shutil.which("jq"), "jq is required")
class AssertionToolsTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="athenz-assertion-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.tools = self.root / "tools"
        (self.tools / "athenz").mkdir(parents=True)
        for name in ("sign-rfc7523-assertion.sh", "fetch-access-token-with-rfc7523.sh"):
            shutil.copy2(TOOLS / "athenz" / name, self.tools / "athenz" / name)
        shutil.copy2(TOOLS / "color.sh", self.tools / "color.sh")
        port = self.tools / "port.sh"
        port.write_text('#!/bin/sh\ncase "$1" in zts) echo 8443 ;; *) exit 1 ;; esac\n')
        port.chmod(0o755)
        curl = self.root / "curl"
        curl.write_text(f"#!{sys.executable}\n" + MOCK_CURL)
        curl.chmod(0o755)
        openssl = self.root / "openssl"
        openssl.write_text(f"#!{sys.executable}\n" + MOCK_OPENSSL)
        openssl.chmod(0o755)
        self.key_placeholder = self.root / "empty-signing-placeholder"
        self.key_placeholder.touch()
        self.response = {"status": 200, "body": {"access_token": ISSUED, "token_type": "Bearer"}}
        self.environment = {
            "PATH": os.pathsep.join((str(self.root), str(Path(shutil.which("jq")).parent), os.defpath)),
            "LC_ALL": "C",
        }

    def run_tool(self, name, *args, input=INPUT + "\n"):
        (self.root / "response.json").write_text(json.dumps(self.response))
        (self.root / "calls.jsonl").write_text("")
        (self.root / "openssl-calls.jsonl").write_text("")
        result = subprocess.run([str(self.tools / "athenz" / name), *args],
                                input=input, env=self.environment, capture_output=True,
                                encoding="utf-8", timeout=10)
        calls = [json.loads(line) for line in (self.root / "calls.jsonl").read_text().splitlines()]
        self.assertNotIn(INPUT, result.stdout + result.stderr)
        self.assertNotIn(ISSUED, result.stderr)
        for call in calls:
            self.assertNotIn(INPUT, " ".join(call["args"]))
        return result, calls

    def request(self, mode="jwt-bearer", *expectation, input=INPUT + "\n"):
        args = ["-", "api:role.docs-getter", "--mode", mode]
        if expectation:
            args += ["--expect", *expectation]
        return self.run_tool("fetch-access-token-with-rfc7523.sh", *args, input=input)

    def sign(self, *args):
        return self.run_tool("sign-rfc7523-assertion.sh",
                             "--principal", "human.fixture", "--private-key", str(self.key_placeholder),
                             "--key-id", "fixture", "--expires-in", "300", *args)

    def assertion_claims(self, result):
        self.assertEqual(0, result.returncode, result.stderr)
        header, payload, signature = result.stdout.strip().split(".")
        decoded = lambda part: json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
        self.assertEqual({"alg": "RS256", "typ": "at+jwt", "kid": "fixture"}, decoded(header))
        self.assertEqual(base64.urlsafe_b64encode(b"fixture-not-a-signature").decode().rstrip("="), signature)
        self.assertNotIn(result.stdout.strip(), result.stderr)
        return decoded(payload)

    def test_both_paths_send_the_expected_form_fields(self):
        for mode, grant, field in (
            ("jwt-bearer", "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion@-"),
            ("client-assertion", "client_credentials", "client_assertion@-"),
        ):
            with self.subTest(mode=mode):
                result, calls = self.request(mode)
                self.assertEqual(0, result.returncode, result.stderr)
                self.assertEqual(1, len(calls))
                args = calls[0]["args"]
                self.assertEqual(INPUT, calls[0]["stdin"])
                self.assertIn("grant_type=" + grant, args)
                self.assertIn(field, args)
                self.assertIn("scope=api:role.docs-getter", args)
                self.assertIn("https://localhost:8443/zts/v1/oauth2/token", args)
                self.assertEqual("-q", args[0])
                self.assertIn("--noproxy", args)
                self.assertNotIn("--cert", args)
                self.assertNotIn("--key", args)
                self.assertEqual(mode == "client-assertion", any(arg.startswith("client_assertion_type=") for arg in args))
                self.assertEqual(ISSUED + "\n", result.stdout)
                self.assertIn("ZTS response (HTTP 200; credential values redacted)", result.stderr)
                self.assertIn('"access_token": "<redacted>"', result.stderr)
                self.assertIn(json.dumps({"header": ISSUED_HEADER, "claims": ISSUED_CLAIMS}, indent=2), result.stderr)
                self.assertNotIn("matched the expected result", result.stderr)

    def test_expected_status_does_not_change_the_http_request(self):
        for mode in ("client-assertion", "jwt-bearer"):
            with self.subTest(mode=mode):
                observed, observed_calls = self.request(mode)
                checked, checked_calls = self.request(mode, "200")
                self.assertEqual(0, observed.returncode, observed.stderr)
                self.assertEqual(0, checked.returncode, checked.stderr)
                self.assertEqual(observed_calls, checked_calls)
                self.assertEqual(observed.stdout, checked.stdout)
                self.assertIn("matched the expected result", checked.stderr)

    def test_unexpected_rejections_fail_after_logging_the_full_response(self):
        for status in (400, 403, 503):
            with self.subTest(status=status):
                self.response = {"status": status, "body": {"code": status, "message": ERROR}}
                result, _ = self.request()
                self.assertNotEqual(0, result.returncode)
                self.assertEqual("", result.stdout)
                self.assertIn(f"ZTS response (HTTP {status}; credential values redacted)", result.stderr)
                self.assertIn(json.dumps(self.response["body"], indent=2), result.stderr)

    def test_expected_400_requires_the_validation_error_and_no_access_token(self):
        for body, expected in (
            ({"code": 400, "message": ERROR}, 0),
            ({"code": 400, "message": "Expired assertion"}, 1),
            ({"code": 403, "message": ERROR}, 1),
            ({"code": 400}, 1),
            ({"code": 400, "message": ERROR, "access_token": ISSUED}, 1),
            ({"code": 400, "message": ERROR, "access_token": ""}, 1),
        ):
            with self.subTest(body=body):
                self.response = {"status": 400, "body": body}
                result, _ = self.request("client-assertion", "400", "does not identify the token endpoint")
                self.assertEqual(expected, result.returncode, result.stderr)
                self.assertEqual("", result.stdout)

    def test_expected_200_requires_a_bearer_access_token(self):
        for body in ({}, {"access_token": "", "token_type": "Bearer"},
                     {"access_token": ISSUED, "token_type": "MAC"}):
            with self.subTest(body=body):
                self.response["body"] = body
                result, _ = self.request("jwt-bearer", "200")
                self.assertNotEqual(0, result.returncode)
                self.assertIn("did not contain a Bearer access token", result.stderr)

    def test_status_mismatch_fails_after_displaying_the_response(self):
        result, _ = self.request("jwt-bearer", "400", "does not identify the token endpoint")
        self.assertNotEqual(0, result.returncode)
        self.assertEqual("", result.stdout)
        self.assertIn("ZTS response (HTTP 200; credential values redacted)", result.stderr)
        self.assertIn('"access_token": "<redacted>"', result.stderr)
        self.assertIn("Expected HTTP 400, received 200", result.stderr)

    def test_transport_and_response_format_errors_fail(self):
        for response in ({"status": 200, "body": {}, "curl_exit": 7},
                         {"status": "invalid", "body": {}},
                         {"status": 502, "body": "not JSON"},
                         {"status": 200, "body": []}):
            with self.subTest(response=response):
                self.response = response
                result, _ = self.request()
                self.assertNotEqual(0, result.returncode)
                self.assertEqual("", result.stdout)

    def test_invalid_arguments_and_empty_input_do_not_send_requests(self):
        for args in ((), ("",), ("-", ""), ("-", "--mode", "unknown"),
                     ("-", "--mode", "client-assertion"), ("-", "--mode"),
                     ("-", "scope", "--unknown"), ("-", "scope", "--expect"),
                     ("-", "scope", "--expect", "400"),
                     ("-", "scope", "--expect", "400", ""),
                     ("-", "scope", "--expect", "400", "--mode", "jwt-bearer"),
                     ("-", "scope", "--expect", "200", "error"),
                     ("-", "scope", "--expect", "500"),
                     ("-", "scope", "--expect", "", "error"),
                     ("-", "scope", "--expect", "200", "--expect", "200")):
            with self.subTest(args=args):
                result, calls = self.run_tool("fetch-access-token-with-rfc7523.sh", *args)
                self.assertNotEqual(0, result.returncode)
                self.assertEqual([], calls)
        for value in ("", "\n"):
            with self.subTest(input=value):
                result, calls = self.request(input=value)
                self.assertNotEqual(0, result.returncode)
                self.assertEqual([], calls)

    def test_input_without_a_final_newline_is_accepted(self):
        result, _ = self.request(input=INPUT)
        self.assertEqual(0, result.returncode, result.stderr)

    def test_single_argument_and_stdin_support_scope_in_the_assertion(self):
        for assertion, stdin in ((INPUT, ""), ("-", INPUT + "\n")):
            with self.subTest(assertion=assertion):
                result, calls = self.run_tool("fetch-access-token-with-rfc7523.sh", assertion, input=stdin)
                self.assertEqual(0, result.returncode, result.stderr)
                self.assertEqual(ISSUED + "\n", result.stdout)
                self.assertEqual(INPUT, calls[0]["stdin"])
                self.assertIn("assertion@-", calls[0]["args"])
                self.assertFalse(any(arg.startswith("scope=") for arg in calls[0]["args"]))
                self.assertIn("Using the scope claim from the assertion", result.stderr)

    def test_explicit_scope_with_default_mode_matches_the_explicit_mode(self):
        default, default_calls = self.run_tool("fetch-access-token-with-rfc7523.sh", "-", "api:role.docs-getter")
        explicit, explicit_calls = self.request()
        self.assertEqual(0, default.returncode, default.stderr)
        self.assertEqual((explicit.stdout, explicit.stderr, explicit_calls),
                         (default.stdout, default.stderr, default_calls))

    def test_response_logs_preserve_details_and_redact_credential_values(self):
        self.response["body"].update({"refresh_token": "fixture-refresh-not-a-real-token",
                                      "id_token": "fixture-id-not-a-real-token",
                                      "expires_in": 300, "scope": "docs-getter"})
        result, _ = self.request()
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(ISSUED + "\n", result.stdout)
        for field in ("access_token", "refresh_token", "id_token"):
            self.assertNotIn(self.response["body"][field], result.stderr)
            self.assertIn(f'"{field}": "<redacted>"', result.stderr)
        self.assertIn('"expires_in": 300', result.stderr)
        self.assertIn('"scope": "docs-getter"', result.stderr)

    def test_bearer_token_type_is_case_insensitive(self):
        self.response["body"]["token_type"] = "bearer"
        result, _ = self.request()
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(ISSUED + "\n", result.stdout)

    def test_token_metadata_decodes_base64url_characters(self):
        claims = {"fixture": ">>>???"}
        payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")
        self.assertIn("-", payload)
        self.assertIn("_", payload)
        token = ISSUED.split(".")[0] + "." + payload + ".not-a-signature"
        self.response["body"]["access_token"] = token
        result, _ = self.request()
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(token + "\n", result.stdout)
        self.assertNotIn(token, result.stderr)
        self.assertIn(json.dumps({"header": ISSUED_HEADER, "claims": claims}, indent=2), result.stderr)

    def test_invalid_token_metadata_fails_without_logging_the_token(self):
        token = "fixture-invalid-output-not-a-real-token"
        self.response["body"]["access_token"] = token
        result, _ = self.request()
        self.assertNotEqual(0, result.returncode)
        self.assertEqual("", result.stdout)
        self.assertNotIn(token, result.stderr)
        self.assertIn("Could not decode the JWT access token header and claims", result.stderr)

    def test_signer_discovers_the_issuer_using_the_configured_local_port(self):
        for port in (8443, 9443):
            with self.subTest(port=port):
                (self.tools / "port.sh").write_text(f'#!/bin/sh\necho {port}\n')
                issuer = f"https://issuer-{port}.example/zts/v1"
                self.response = {"status": 200, "body": {
                    "issuer": issuer, "token_endpoint": issuer + "/oauth2/token",
                    "id_token_signing_alg_values_supported": ["RS256"],
                }}
                result, calls = self.sign()
                claims = self.assertion_claims(result)
                self.assertEqual(issuer, claims["aud"])
                self.assertEqual("human.fixture", claims["iss"])
                self.assertEqual(claims["iss"], claims["sub"])
                self.assertEqual(300, claims["exp"] - claims["iat"])
                self.assertNotIn("scope", claims)
                self.assertEqual(1, len(calls))
                args = calls[0]["args"]
                self.assertIn(f"https://localhost:{port}/zts/v1/.well-known/openid-configuration", args)
                self.assertEqual("-q", args[0])
                self.assertIn("--noproxy", args)
                for forbidden in ("--cert", "--key", "--data-urlencode", str(self.key_placeholder)):
                    self.assertNotIn(forbidden, args)
                self.assertEqual("", calls[0]["stdin"])
                self.assertIn("ZTS discovery response (HTTP 200)", result.stderr)
                self.assertIn(json.dumps(self.response["body"], indent=2), result.stderr)
                self.assertIn(f"Assertion audience (ZTS issuer): {issuer}", result.stderr)

    def test_signer_explicit_audience_skips_discovery_and_keeps_optional_scope(self):
        self.response = {"status": 503, "body": {}, "curl_exit": 7}
        result, calls = self.sign("--audience", "https://explicit.example/zts/v1", "--scope", "api:role.docs-getter")
        claims = self.assertion_claims(result)
        self.assertEqual("https://explicit.example/zts/v1", claims["aud"])
        self.assertEqual("api:role.docs-getter", claims["scope"])
        self.assertEqual([], calls)
        self.assertIn("Assertion audience (explicit): https://explicit.example/zts/v1", result.stderr)

    def test_signer_stops_before_signing_when_discovery_fails(self):
        invalid = [{"status": 200, "body": body} for body in (
            {}, {"issuer": None}, {"issuer": 42}, {"issuer": []}, {"issuer": ""},
            {"issuer": " \n"}, {"issuer": "https://issuer.example/invalid path"}, [], "not JSON",
        )]
        invalid += [
            {"status": status, "body": {"issuer": "https://issuer.example/zts/v1", "message": "fixture rejection"}}
            for status in (302, 400, 503, "invalid")
        ]
        invalid.append({"status": 200, "body": {}, "curl_exit": 7})
        for response in invalid:
            with self.subTest(response=response):
                self.response = response
                result, calls = self.sign()
                self.assertNotEqual(0, result.returncode)
                self.assertEqual("", result.stdout)
                self.assertEqual(1, len(calls))
                openssl_calls = [json.loads(line) for line in (self.root / "openssl-calls.jsonl").read_text().splitlines()]
                self.assertFalse(any(args[0] == "dgst" for args in openssl_calls))
                self.assertNotIn("Assertion audience (ZTS issuer)", result.stderr)
                if response["status"] in (302, 400, 503):
                    self.assertIn(json.dumps(response["body"], indent=2), result.stderr)

    def test_signer_rejects_empty_or_missing_explicit_audience_before_discovery(self):
        for args in (("--audience",), ("--audience", "")):
            with self.subTest(args=args):
                result, calls = self.sign(*args)
                self.assertNotEqual(0, result.returncode)
                self.assertEqual("", result.stdout)
                self.assertEqual([], calls)
                self.assertEqual("", (self.root / "openssl-calls.jsonl").read_text())

    def test_help_does_not_send_requests(self):
        for name in ("sign-rfc7523-assertion.sh", "fetch-access-token-with-rfc7523.sh"):
            with self.subTest(name=name):
                result, calls = self.run_tool(name, "--help", input="")
                self.assertEqual(0, result.returncode, result.stderr)
                self.assertIn("Usage:", result.stdout)
                self.assertEqual([], calls)


if __name__ == "__main__":
    unittest.main()
