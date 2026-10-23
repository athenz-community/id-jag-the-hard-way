"""Exercise the helper and research commands without keys, certificates, or a cluster."""

import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest


TOOLS = Path(__file__).resolve().parents[2]
RESEARCH = TOOLS.parent / "research/athenz/service-cert/261023-test-athenz-feature-zts-svccert-hostname.md"
OUTPUT_PLACEHOLDER = "mock-output-placeholder-not-a-certificate\n"
POD_IP = "10.244.0.25"
HOSTNAME = "10-244-0-25.athenz.pod.cluster.local"
BASELINE_SAN = (
    "X509v3 Subject Alternative Name:\n"
    "    DNS:idjag-learner.human.zts.athenz.cloud, "
    "URI:spiffe://human/sa/idjag-learner, "
    "URI:athenz://instanceid/sys.auth.zts/mock-instance\n"
)
HOSTNAME_URI = "URI:athenz://hostname/" + HOSTNAME
HOSTNAME_SAN = BASELINE_SAN.rstrip() + ", IP Address:" + POD_IP + ", " + HOSTNAME_URI + "\n"
EXTRACTION_ERROR = "Expected exactly one non-empty athenz://hostname/ URI SAN\n"
RESOLVER_SETTING = "athenz.zts.hostname_resolver_factory_class=io.github.mlajkim.idthw.cert.PodHostnameResolverFactory"
MOCK_COMMAND = r'''
import json
from pathlib import Path
import sys

root = Path(__file__).parent
name = Path(__file__).name
args = sys.argv[1:]
with (root / "calls.jsonl").open("a") as log:
    log.write(json.dumps({"command": name, "args": args}) + "\n")
fixture = name
if name == "kubectl":
    if args[:4] == ["-n", "athenz", "get", "pods"]:
        fixture = "pod"
    elif args[:4] == ["-n", "athenz", "get", "configmap"]:
        fixture = "config"
    elif args[:4] == ["-n", "athenz", "patch", "configmap"]:
        fixture = "patch"
    elif args[:7] == ["-n", "athenz", "exec", "deploy/athenz-cli", "--", "getent", "hosts"]:
        fixture = "dns"
    elif args[:2] != ["exec", "-i"]:
        sys.stderr.write("Unexpected mock kubectl command\n")
        sys.exit(99)
response = json.loads((root / "responses.json").read_text())[fixture]
# Do not execute kubectl's remote command or open OpenSSL's -in argument.
sys.stdout.write(response["stdout"])
sys.stderr.write(response["stderr"])
sys.exit(response["status"])
'''


def research_command(name):
    text = RESEARCH.read_text()
    match = re.search(
        rf"<!-- mock-check: {re.escape(name)} -->\s*```sh\n(.*?)\n```", text, re.S
    )
    if not match:
        raise AssertionError(f"Research command not found: {name}")
    return match.group(1)


class SvccertHostnameTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="athenz-hostname-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.bin = self.root / "mock-bin"
        self.bin.mkdir()
        (self.root / "tools/athenz").mkdir(parents=True)
        shutil.copy2(TOOLS / "athenz/fetch-cert.sh", self.root / "tools/athenz/fetch-cert.sh")
        shutil.copy2(TOOLS / "color.sh", self.root / "tools/color.sh")
        (self.root / "keys").mkdir()
        # An empty file satisfies the helper's file check; it contains no key.
        (self.root / "keys/idjag-learner.key").touch()
        for name in ("kubectl", "openssl"):
            executable = self.bin / name
            executable.write_text(f"#!{sys.executable}\n" + MOCK_COMMAND)
            executable.chmod(0o755)
        self.responses = {
            "kubectl": {"stdout": OUTPUT_PLACEHOLDER, "stderr": "", "status": 0},
            "pod": {"stdout": POD_IP, "stderr": "", "status": 0},
            "dns": {"stdout": POD_IP + "     " + HOSTNAME + "\n", "stderr": "", "status": 0},
            "config": {"stdout": json.dumps({
                "metadata": {"resourceVersion": "7"},
                "data": {"zts.properties": "existing.setting=keep\n", "unrelated": "keep"},
            }), "stderr": "", "status": 0},
            "patch": {"stdout": "configmap/athenz-zts-conf patched\n", "stderr": "", "status": 0},
            "openssl": {"stdout": HOSTNAME_SAN, "stderr": "", "status": 0},
        }
        # Do not inherit kubeconfig, credentials, or shell startup configuration.
        self.environment = {
            "PATH": os.pathsep.join((str(self.bin), str(Path(sys.executable).parent), os.defpath)),
            "TMPDIR": str(self.root),
            "LC_ALL": "C",
            "FETCH_CERT_RETRIES": "1",
            "FETCH_CERT_RETRY_DELAY_SECONDS": "0",
        }

    def run_command(self, command):
        (self.bin / "responses.json").write_text(json.dumps(self.responses))
        (self.bin / "calls.jsonl").write_text("")
        result = subprocess.run(
            ["/bin/bash", "-c", command], cwd=self.root, env=self.environment,
            capture_output=True, text=True, timeout=10,
        )
        calls = [json.loads(line) for line in (self.bin / "calls.jsonl").read_text().splitlines()]
        self.assertNotIn(OUTPUT_PLACEHOLDER, result.stdout + result.stderr)
        return result, calls

    def request(self, *args):
        return self.run_command(shlex.join([
            "./tools/athenz/fetch-cert.sh", "human", "idjag-learner",
            "./keys/idjag-learner.key", "v1", *args,
        ]))

    def cli_arguments(self, calls):
        requests = [call for call in calls if call["args"][:2] == ["exec", "-i"]]
        self.assertEqual(1, len(requests))
        self.assertEqual("kubectl", requests[0]["command"])
        args = requests[0]["args"]
        self.assertEqual(
            ["exec", "-i", "deploy/athenz-cli", "-n", "athenz", "--", "sh", "-c"], args[:-1]
        )
        remote = args[-1]
        syntax = subprocess.run(
            ["/bin/sh", "-n", "-c", remote], env=self.environment,
            capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(0, syntax.returncode, syntax.stderr)
        # Inspect the assembled command without executing it or its file operations.
        cli = remote.split("zts-svccert", 1)[1].split("&&", 1)[0]
        self.assertNotIn("/dev/null", cli)
        self.assertIn(">&2", cli)
        return shlex.split(cli)

    def assert_option(self, args, flag, value):
        self.assertEqual(1, args.count(flag))
        self.assertEqual(value, args[args.index(flag) + 1])

    def test_baseline_request_preserves_provider_and_omits_hostname(self):
        result, calls = self.run_command(research_command("baseline-request"))
        self.assertEqual(0, result.returncode, result.stderr)
        args = self.cli_arguments(calls)
        self.assertNotIn("-hostname", args)
        self.assertNotIn("-ip", args)
        self.assert_option(args, "-provider", "sys.auth.zts")
        self.assert_option(args, "-domain", "human")
        self.assert_option(args, "-service", "idjag-learner")
        self.assert_option(args, "-key-version", "v1")
        self.assert_option(args, "-dns-domain", "zts.athenz.cloud")
        self.assertIn("-instance", args)
        self.assertEqual(OUTPUT_PLACEHOLDER, (self.root / "keys/svccert-hostname/baseline.crt").read_text())
        self.assertNotIn("Requesting hostname", result.stdout)

    def test_hostname_request_forwards_hostname_and_preserves_defaults(self):
        result, calls = self.run_command(research_command("hostname-request"))
        self.assertEqual(0, result.returncode, result.stderr)
        args = self.cli_arguments(calls)
        self.assertEqual(3, len(calls))
        self.assertEqual(
            ["-n", "athenz", "get", "pods", "-l", "app.kubernetes.io/name=athenz-cli",
             "-o", "jsonpath={.items[0].status.podIP}"], calls[0]["args"]
        )
        self.assertEqual(
            ["-n", "athenz", "exec", "deploy/athenz-cli", "--", "getent", "hosts", HOSTNAME],
            calls[1]["args"],
        )
        self.assert_option(args, "-hostname", HOSTNAME)
        self.assert_option(args, "-ip", POD_IP)
        self.assert_option(args, "-provider", "sys.auth.zts")
        self.assert_option(args, "-domain", "human")
        self.assert_option(args, "-service", "idjag-learner")
        self.assert_option(args, "-key-version", "v1")
        self.assert_option(args, "-dns-domain", "zts.athenz.cloud")
        self.assertIn("-instance", args)
        self.assertEqual(OUTPUT_PLACEHOLDER, (self.root / "keys/svccert-hostname/with-hostname.crt").read_text())
        self.assertIn("Requesting hostname URI SAN: athenz://hostname/" + HOSTNAME, result.stdout)
        self.assertIn("Requesting IP SAN: " + POD_IP, result.stdout)

    def test_hostname_combines_with_existing_options_and_ip_families(self):
        for address in (POD_IP, "2001:db8::25"):
            with self.subTest(address=address):
                result, calls = self.request(
                    "--dns-domain", "example.net", "--hostname", "worker-2.example.com",
                    "--ip", address, "--output", "./keys/custom output.crt",
                )
                self.assertEqual(0, result.returncode, result.stderr)
                args = self.cli_arguments(calls)
                self.assert_option(args, "-hostname", "worker-2.example.com")
                self.assert_option(args, "-ip", address)
                self.assert_option(args, "-dns-domain", "example.net")
                self.assertEqual(OUTPUT_PLACEHOLDER, (self.root / "keys/custom output.crt").read_text())

    def test_hostname_requires_ip_for_zts_provider(self):
        result, calls = self.request("--hostname", HOSTNAME)
        self.assertEqual(1, result.returncode)
        self.assertEqual([], calls)
        self.assertIn("--hostname requires --ip with the sys.auth.zts provider", result.stderr)

    def test_invalid_or_missing_ip_never_calls_kubectl(self):
        for values in ((), ("",), ("999.1.1.1",), ("10.0.0",), ("2001:db8::invalid",),
                       ("$(id)",), ("10.0.0.1;id",), ("fe80::1%eth0",)):
            with self.subTest(values=values):
                result, calls = self.request("--hostname", HOSTNAME, "--ip", *values)
                self.assertEqual(1, result.returncode)
                self.assertEqual([], calls)
                self.assertRegex(result.stderr, "Missing value for --ip|Invalid IP address")

    def test_missing_pod_ip_stops_before_request(self):
        self.responses["pod"]["stdout"] = ""
        result, calls = self.run_command(research_command("hostname-request"))
        self.assertEqual(1, result.returncode)
        self.assertEqual(1, len(calls))
        self.assertFalse((self.root / "keys/svccert-hostname/with-hostname.crt").exists())

    def test_dns_failure_stops_before_request(self):
        diagnostic = "mock pod hostname did not resolve\n"
        self.responses["dns"] = {"stdout": "", "stderr": diagnostic, "status": 2}
        result, calls = self.run_command(research_command("hostname-request"))
        self.assertEqual(2, result.returncode)
        self.assertEqual(2, len(calls))
        self.assertEqual(diagnostic, result.stderr)
        self.assertFalse((self.root / "keys/svccert-hostname/with-hostname.crt").exists())

    def test_invalid_or_missing_hostname_never_calls_kubectl(self):
        cases = [(), ("",), ("bad host",), ("$(id)",), ("node;id",),
                 ("-node.example.com",), ("node..example.com",), ("node/name",)]
        for values in cases:
            with self.subTest(values=values):
                result, calls = self.request("--hostname", *values)
                self.assertEqual(1, result.returncode)
                self.assertEqual([], calls)
                self.assertRegex(result.stderr, "Missing value for --hostname|Invalid hostname")

    def test_request_failure_keeps_diagnostics_and_does_not_save_output(self):
        for diagnostic in (
            "flag provided but not defined: -hostname\nmock CLI rejected the option\n",
            "400 CSR validation failed - Unable to validate Instance hostname: " + HOSTNAME + "\n",
        ):
            with self.subTest(diagnostic=diagnostic):
                self.responses["kubectl"] = {"stdout": "", "stderr": diagnostic, "status": 2}
                result, calls = self.run_command(research_command("hostname-request"))
                self.assertEqual(1, result.returncode)
                self.cli_arguments(calls)
                self.assertIn(diagnostic, result.stderr)
                self.assertIn("after 1 attempts", result.stderr)
                self.assertFalse((self.root / "keys/svccert-hostname/with-hostname.crt").exists())

    @unittest.skipUnless(shutil.which("jq"), "jq is required")
    def test_resolver_config_preserves_properties_and_uses_resource_version(self):
        result, calls = self.run_command(research_command("resolver-config"))
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(2, len(calls))
        self.assertEqual(["-n", "athenz", "get", "configmap", "athenz-zts-conf", "-o", "json"], calls[0]["args"])
        args = calls[1]["args"]
        self.assertEqual(["-n", "athenz", "patch", "configmap", "athenz-zts-conf", "--type", "merge", "--patch"], args[:-1])
        self.assertEqual({
            "metadata": {"resourceVersion": "7"},
            "data": {"zts.properties": "existing.setting=keep\n\n" + RESOLVER_SETTING + "\n"},
        }, json.loads(args[-1]))

    @unittest.skipUnless(shutil.which("jq"), "jq is required")
    def test_resolver_config_does_not_overwrite_an_existing_resolver(self):
        config = json.loads(self.responses["config"]["stdout"])
        config["data"]["zts.properties"] += "athenz.zts.hostname_resolver_factory_class=existing.Factory\n"
        self.responses["config"]["stdout"] = json.dumps(config)
        result, calls = self.run_command(research_command("resolver-config"))
        self.assertNotEqual(0, result.returncode)
        self.assertEqual(1, len(calls))
        self.assertIn("A different hostname resolver is already configured", result.stderr)

    @unittest.skipUnless(shutil.which("jq"), "jq is required")
    def test_resolver_config_does_not_duplicate_its_setting(self):
        config = json.loads(self.responses["config"]["stdout"])
        config["data"]["zts.properties"] += RESOLVER_SETTING + "\n"
        self.responses["config"]["stdout"] = json.dumps(config)
        result, calls = self.run_command(research_command("resolver-config"))
        self.assertEqual(0, result.returncode, result.stderr)
        patch = json.loads(calls[-1]["args"][-1])
        self.assertEqual(config["data"]["zts.properties"], patch["data"]["zts.properties"])

    def test_extracts_hostname_from_uri_among_other_sans(self):
        result, calls = self.run_command(research_command("extract-hostname"))
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(HOSTNAME + "\n", result.stdout)
        self.assertEqual("", result.stderr)
        self.assertEqual([{
            "command": "openssl",
            "args": ["x509", "-in", "./keys/svccert-hostname/with-hostname.crt",
                     "-noout", "-ext", "subjectAltName"],
        }], calls)

    def test_extracts_hostname_when_sans_are_wrapped_or_reordered(self):
        for metadata in (
            "X509v3 Subject Alternative Name: critical\n    " + HOSTNAME_URI + ",\n" + BASELINE_SAN,
            HOSTNAME_URI + "\n",
            "DNS:other.example.com,\t" + HOSTNAME_URI + ", URI:spiffe://human/sa/idjag-learner",
        ):
            with self.subTest(metadata=metadata):
                self.responses["openssl"]["stdout"] = metadata
                result, _ = self.run_command(research_command("extract-hostname"))
                self.assertEqual(0, result.returncode, result.stderr)
                self.assertEqual(HOSTNAME + "\n", result.stdout)

    def test_dns_or_spiffe_names_do_not_replace_a_missing_hostname_uri(self):
        for metadata in (
            BASELINE_SAN,
            "DNS:" + HOSTNAME + ", URI:spiffe://hostname/" + HOSTNAME + "\n",
            "URI:athenz://hostname-other/" + HOSTNAME + "\n",
            "",
        ):
            with self.subTest(metadata=metadata):
                self.responses["openssl"]["stdout"] = metadata
                result, _ = self.run_command(research_command("extract-hostname"))
                self.assertEqual(1, result.returncode)
                self.assertEqual("", result.stdout)
                self.assertEqual(EXTRACTION_ERROR, result.stderr)

    def test_empty_or_multiple_hostname_uris_fail(self):
        for metadata in (
            "URI:athenz://hostname/\n",
            HOSTNAME_URI + ", " + HOSTNAME_URI,
            HOSTNAME_URI + ", URI:athenz://hostname/node2.example.com",
        ):
            with self.subTest(metadata=metadata):
                self.responses["openssl"]["stdout"] = metadata
                result, _ = self.run_command(research_command("extract-hostname"))
                self.assertEqual(1, result.returncode)
                self.assertEqual("", result.stdout)
                self.assertEqual(EXTRACTION_ERROR, result.stderr)

    def test_openssl_failure_is_not_reported_as_success(self):
        # Even plausible partial stdout must not be used after an OpenSSL failure.
        diagnostic = "mock OpenSSL input failure\n"
        self.responses["openssl"] = {"stdout": HOSTNAME_SAN, "stderr": diagnostic, "status": 7}
        result, calls = self.run_command(research_command("extract-hostname"))
        self.assertEqual(7, result.returncode)
        self.assertEqual("", result.stdout)
        self.assertEqual(diagnostic, result.stderr)
        self.assertEqual(1, len(calls))


if __name__ == "__main__":
    unittest.main()
