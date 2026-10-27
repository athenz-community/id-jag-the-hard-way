import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest


TOOLS = Path(__file__).resolve().parents[2]
FIXTURE_TOKEN = "not-a-real-role-token"


class FetchRoleTokenTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="idthw-role-token-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.tools = self.root / "tools"
        (self.tools / "athenz").mkdir(parents=True)
        self.script = self.tools / "athenz/fetch-role-token.sh"
        shutil.copy2(TOOLS / "athenz/fetch-role-token.sh", self.script)
        shutil.copy2(TOOLS / "color.sh", self.tools / "color.sh")
        port = self.tools / "port.sh"
        port.write_text('#!/bin/sh\n[ "$1" = zts ] || exit 1\nprintf "18443\\n"\n')
        port.chmod(0o755)

        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.calls = self.root / "curl-call.json"
        curl = self.bin / "curl"
        # This stand-in never opens identity files or makes a network request.
        curl.write_text(f"#!{sys.executable}\n" + '''
import json
import os
from pathlib import Path
import sys

args = sys.argv[1:]
Path(os.environ["IDTHW_ROLE_TEST_CALLS"]).write_text(json.dumps(args))
if os.environ.get("IDTHW_ROLE_TEST_FAIL") == "true":
    if "-sS" in args:
        print("curl: (7) fixture connection failed", file=sys.stderr)
    sys.exit(7)
sys.stdout.write(os.environ["IDTHW_ROLE_TEST_RESPONSE"])
sys.stdout.write("\\n" + os.environ.get("IDTHW_ROLE_TEST_STATUS", "200"))
''')
        curl.chmod(0o755)

    def run_helper(self, *extra, args=None, response=None, **environment):
        if args is None:
            args = ["/dev/null", "/dev/null", "api", "docs-getter"]
        env = {
            "PATH": f"{self.bin}:{os.environ['PATH']}",
            "IDTHW_ROLE_TEST_CALLS": str(self.calls),
            "IDTHW_ROLE_TEST_RESPONSE": response if response is not None else json.dumps({
                "token": FIXTURE_TOKEN, "expiryTime": 2000000600,
            }),
            **environment,
        }
        return subprocess.run(
            [str(self.script), *args, *extra], cwd=self.root,
            env=env, capture_output=True, text=True, timeout=10,
        )

    def curl_args(self):
        return json.loads(self.calls.read_text())

    def test_local_default_and_visible_logs_with_token_only_stdout(self):
        result = self.run_helper()
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(FIXTURE_TOKEN + "\n", result.stdout)
        self.assertIn("Fetching Role Token for role: api:role.docs-getter", result.stderr)
        self.assertIn("Role token issued for role: api:role.docs-getter", result.stderr)
        self.assertIn('"expiryTime": 2000000600', result.stderr)
        self.assertNotIn(FIXTURE_TOKEN, result.stderr)
        args = self.curl_args()
        self.assertEqual("https://localhost:18443/zts/v1/domain/api/token", args[-1])
        self.assertIn("--get", args)
        self.assertIn("role=docs-getter", args)
        self.assertIn("minExpiryTime=600", args)
        self.assertIn("maxExpiryTime=600", args)
        self.assertEqual("10", args[args.index("--connect-timeout") + 1])
        self.assertEqual("30", args[args.index("--max-time") + 1])
        self.assertEqual(
            self.root / "athenz_dist/certs/ca.cert.pem",
            Path(args[args.index("--cacert") + 1]).resolve(),
        )
        self.assertNotIn("-k", args)

    def test_custom_endpoint_and_identity_paths_are_passed_without_reading_them(self):
        result = self.run_helper(
            args=["fixture cert path", "fixture key path", "api", "docs-getter"],
            ZTS_URL="https://selected.example.test/prefix/zts/v1/",
            ATHENZ_CA_CERT="fixture CA path",
        )
        self.assertEqual(0, result.returncode, result.stderr)
        args = self.curl_args()
        self.assertEqual("https://selected.example.test/prefix/zts/v1/domain/api/token", args[-1])
        for flag, value in [("--cert", "fixture cert path"), ("--key", "fixture key path"), ("--cacert", "fixture CA path")]:
            self.assertEqual(value, args[args.index(flag) + 1])

    def test_both_output_forms_save_a_private_file(self):
        for options in [("saved/positional.token",), ("--output", "saved/flag.token")]:
            with self.subTest(options=options):
                result = self.run_helper(*options)
                self.assertEqual(0, result.returncode, result.stderr)
                output = self.root / options[-1]
                self.assertEqual(FIXTURE_TOKEN + "\n", output.read_text())
                self.assertEqual(0o600, stat.S_IMODE(output.stat().st_mode))
                self.assertIn("Role token saved to:", result.stderr)
                self.assertNotIn(FIXTURE_TOKEN, result.stderr)

    def test_http_failure_keeps_existing_output_and_reports_zts_error(self):
        output = self.root / "previous.token"
        output.write_text("previous fixture value\n")
        result = self.run_helper(str(output), IDTHW_ROLE_TEST_STATUS="403", response=json.dumps({
            "code": 403, "message": "fixture principal is not a role member", "token": FIXTURE_TOKEN,
        }))
        self.assertNotEqual(0, result.returncode)
        self.assertEqual("", result.stdout)
        self.assertIn("HTTP 403", result.stderr)
        self.assertIn('"code": 403', result.stderr)
        self.assertIn('"message": "fixture principal is not a role member"', result.stderr)
        self.assertNotIn(FIXTURE_TOKEN, result.stderr)
        self.assertEqual("previous fixture value\n", output.read_text())

    def test_connection_failure_keeps_curl_diagnostics_visible(self):
        result = self.run_helper(IDTHW_ROLE_TEST_FAIL="true")
        self.assertNotEqual(0, result.returncode)
        self.assertEqual("", result.stdout)
        self.assertIn("Fetching Role Token", result.stderr)
        self.assertIn("curl: (7) fixture connection failed", result.stderr)
        self.assertIn("Failed to connect to ZTS", result.stderr)

    def test_bad_success_responses_do_not_emit_or_save_a_token(self):
        for response in ["not JSON", "{}", '{"token":""}', '{"token":true}', '{"token":"fixture\\nheader"}']:
            with self.subTest(response=response):
                result = self.run_helper("bad.token", response=response)
                self.assertNotEqual(0, result.returncode)
                self.assertEqual("", result.stdout)
                self.assertIn("ZTS response did not include", result.stderr)
                self.assertFalse((self.root / "bad.token").exists())

    def test_invalid_arguments_stop_before_curl(self):
        for args in [
            [], ["/dev/null", "/dev/null", "api"],
            ["/dev/null", "/dev/null", "../api", "docs-getter"],
            ["/dev/null", "/dev/null", "api", ""],
            ["/dev/null", "/dev/null", "api", "docs-getter,admin"],
            ["/dev/null", "/dev/null", "api", "docs-getter", "--output"],
        ]:
            with self.subTest(args=args):
                self.assertNotEqual(0, self.run_helper(args=args).returncode)
                self.assertFalse(self.calls.exists())

    def test_invalid_endpoint_stops_before_curl(self):
        for url in [
            "ftp://example.test/zts/v1", "https://example.test/zms/v1",
            "https://user@example.test/zts/v1", "https://example.test/zts/v1?role=admin",
        ]:
            with self.subTest(url=url):
                result = self.run_helper(ZTS_URL=url)
                self.assertNotEqual(0, result.returncode)
                self.assertIn("ZTS_URL must be", result.stderr)
                self.assertFalse(self.calls.exists())


if __name__ == "__main__":
    unittest.main()
