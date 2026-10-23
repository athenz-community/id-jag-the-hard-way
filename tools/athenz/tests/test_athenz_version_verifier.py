import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import unittest


VERIFIER = Path(__file__).resolve().parents[1] / "athenz-version-verifier.sh"
MOCK_KUBECTL = r'''
import json
from pathlib import Path
import sys

directory = Path(__file__).parent
args = sys.argv[1:]
with (directory / "calls.jsonl").open("a") as log:
    log.write(json.dumps(args) + "\n")
fixture = json.loads((directory / "pods.json").read_text())
if args == ["config", "current-context"]:
    print("kind-test")
elif "get" in args and args[args.index("get") + 1] == "pods":
    if fixture.get("list_error"):
        sys.exit(1)
    for pod in fixture["pods"]:
        print("|".join(str(pod[key]) for key in ("name", "deleting", "phase", "ready")))
elif "exec" in args:
    name = args[args.index("exec") + 1]
    pod = next(pod for pod in fixture["pods"] if pod["name"] == name)
    if pod.get("exec_error"):
        sys.exit(1)
    command = args[args.index("--") + 1:]
    if command == ["printenv", "VERSION"]:
        print(pod["version"])
    elif command == ["sh", "-c", r'printf "%s|%s\n" "${VERSION-}" "${VCS_REF-}"']:
        print(pod["version"] + "|" + pod.get("revision", "e891a2a17c6ec8b0ce4bbb41c4a9c3e02a2ed516"))
    else:
        raise AssertionError(command)
else:
    raise AssertionError(args)
'''


def pod(version="1.12.47", **changes):
    return dict(name="zts-pod", deleting="", phase="Running", ready="true",
                version=version) | changes


@unittest.skipUnless(shutil.which("bash") and shutil.which("jq"), "bash and jq are required")
class VersionVerifierTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="athenz-version-test-")
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        kubectl = self.directory / "kubectl"
        kubectl.write_text(f"#!{sys.executable}\n" + MOCK_KUBECTL)
        kubectl.chmod(0o755)
        self.fixture = {"pods": [pod()]}
        self.environment = {
            "PATH": os.pathsep.join((str(self.directory), str(Path(shutil.which("jq")).parent), os.defpath)),
            "LC_ALL": "C",
        }

    def verify(self, *args):
        (self.directory / "pods.json").write_text(json.dumps(self.fixture))
        (self.directory / "calls.jsonl").write_text("")
        result = subprocess.run([shutil.which("bash"), str(VERIFIER), *args],
                                env=self.environment, capture_output=True, encoding="utf-8", timeout=10)
        output = re.sub(r"\x1b\[[0-9;]*m", "", result.stdout + result.stderr)
        calls = [json.loads(line) for line in (self.directory / "calls.jsonl").read_text().splitlines()]
        return result.returncode, output, calls

    def test_numeric_release_prerelease_and_build_precedence(self):
        for version, maximum_exit, minimum_exit in (
            ("1.12.46", 0, 1),
            ("1.12.47-SNAPSHOT", 0, 1),
            ("1.12.47-rc.1+local", 0, 1),
            ("1.12.47", 0, 0),
            ("v1.12.47+build.42", 0, 0),
            ("1.12.48-SNAPSHOT", 1, 0),
            ("1.12.48", 1, 0),
            ("1.12.9", 0, 1),
            ("1.12.100", 1, 0),
            ("1.2.100", 0, 1),
            ("1.13.0", 1, 0),
            ("2.0.0", 1, 0),
        ):
            self.fixture = {"pods": [pod(version)]}
            for options, expected in ((("--less-or-equal", "1.12.47"), maximum_exit),
                                      (("1.12.47",), minimum_exit)):
                with self.subTest(version=version, options=options):
                    code, output, _ = self.verify(*options)
                    self.assertEqual(expected, code, output)
                    self.assertIn("version check passed" if code == 0 else "✘", output)

    def test_maximum_messages_and_uppercase_alias(self):
        for option in ("--less-or-equal", "--LESS-OR-EQUAL"):
            with self.subTest(option=option):
                code, output, _ = self.verify(option, "v1.12.47")
                self.assertEqual(0, code, output)
                self.assertIn("·  Checking Athenz ZTS version (maximum: 1.12.47, namespace: athenz)", output)
                self.assertIn("✔  zts-pod: 1.12.47 is at or below the maximum 1.12.47", output)
                self.assertIn("✔  Athenz ZTS version check passed", output)

    def test_maximum_failure_does_not_suggest_upgrading(self):
        self.fixture = {"pods": [pod("1.12.48")]}
        code, output, _ = self.verify("--less-or-equal", "1.12.47")
        self.assertEqual(1, code, output)
        self.assertIn("✘  zts-pod: 1.12.48 is above the maximum 1.12.47", output)
        self.assertIn("must be 1.12.47 or older (1 of 1 checked pods above maximum)", output)
        self.assertNotIn("make athenz-vup", output)

    def test_minimum_behavior_and_upgrade_hint_are_preserved(self):
        code, output, _ = self.verify("1.12.48")
        self.assertEqual(1, code, output)
        self.assertIn("1.12.47 is below the minimum 1.12.48", output)
        self.assertIn("must be 1.12.48 or newer (1 of 1 checked pods below minimum)", output)
        self.assertIn("make athenz-vup VERSION=1.12.48", output)

    def test_component_namespace_and_container_selection(self):
        self.fixture = {"pods": [pod(name="zms-pod")]}
        code, output, calls = self.verify("--less-or-equal", "1.12.47", "zms", "comparison")
        self.assertEqual(0, code, output)
        self.assertIn("Athenz ZMS version (maximum: 1.12.47, namespace: comparison)", output)
        for call in calls:
            self.assertEqual("comparison", call[call.index("-n") + 1])
        self.assertIn("app.kubernetes.io/name=athenz-zms-server", calls[0])
        self.assertEqual("athenz-zms-server", calls[1][calls[1].index("-c") + 1])

    def test_every_ready_pod_must_meet_the_limit(self):
        self.fixture = {"pods": [pod(), pod("1.12.48", name="newer-pod")]}
        code, output, _ = self.verify("--less-or-equal", "1.12.47")
        self.assertEqual(1, code, output)
        self.assertIn("1 of 2 checked pods above maximum", output)

    def test_unverifiable_pod_takes_precedence_over_version_mismatch(self):
        for invalid in (pod("latest", name="invalid-pod"),
                        pod(name="pending-pod", phase="Pending", ready="false"),
                        pod(name="unready-pod", ready="false"),
                        pod(name="unreadable-pod", exec_error=True)):
            with self.subTest(pod=invalid):
                self.fixture = {"pods": [pod("1.12.48"), invalid]}
                code, output, _ = self.verify("--less-or-equal", "1.12.47")
                self.assertEqual(2, code, output)
                self.assertIn("version check could not be completed", output)

    def test_missing_or_invalid_build_metadata_is_not_a_version_mismatch(self):
        for version in ("", "latest", "1.12", "01.12.47", "1.12.47\nunexpected", "1.12.47-"):
            with self.subTest(version=version):
                self.fixture = {"pods": [pod(version)]}
                code, output, _ = self.verify("--less-or-equal", "1.12.47")
                self.assertEqual(2, code, output)
                self.assertIn("missing or unsupported build VERSION", output)

    def test_terminating_pods_are_skipped_but_cannot_satisfy_the_check(self):
        terminating = pod("1.12.48", name="terminating-pod", deleting="2026-10-16T00:00:00Z")
        for pods, expected in (([terminating, pod()], 0), ([terminating], 2)):
            with self.subTest(expected=expected):
                self.fixture = {"pods": pods}
                code, output, calls = self.verify("--less-or-equal", "1.12.47")
                self.assertEqual(expected, code, output)
                self.assertIn("Skipping terminating pod terminating-pod", output)
                self.assertFalse(any("exec" in call and "terminating-pod" in call for call in calls))

    def test_list_failure_and_empty_list_cannot_satisfy_the_check(self):
        for fixture in ({"pods": [], "list_error": True}, {"pods": []}):
            with self.subTest(fixture=fixture):
                self.fixture = fixture
                code, output, _ = self.verify("--less-or-equal", "1.12.47")
                self.assertEqual(2, code, output)

    def test_comparison_tool_failure_is_not_a_version_mismatch(self):
        jq = self.directory / "jq"
        jq.write_text("#!/bin/sh\nexit 3\n")
        jq.chmod(0o755)
        code, output, _ = self.verify("--less-or-equal", "1.12.47")
        self.assertEqual(2, code, output)
        self.assertIn("Could not compare the build VERSION", output)

    def test_invalid_arguments_do_not_contact_kubernetes(self):
        for args in ((), ("--less-or-equal",), ("--less-or-equal", "latest"),
                     ("--less-or-equal", "1.12.47-SNAPSHOT"), ("--less-or-equal", "01.12.47"),
                     ("--less-or-equal", "1.12.47", "ui"),
                     ("--less-or-equal", "1.12.47", "zts", "athenz", "extra"),
                     ("--less-or-equal", "--show"), ("--unknown", "1.12.47")):
            with self.subTest(args=args):
                code, output, calls = self.verify(*args)
                self.assertEqual(2, code, output)
                self.assertEqual([], calls)

    def test_help_and_show_still_work(self):
        code, output, calls = self.verify("--help")
        self.assertEqual(0, code, output)
        self.assertIn("--less-or-equal <maximum-version>", output)
        self.assertEqual([], calls)
        code, output, _ = self.verify("--show", "athenz")
        self.assertEqual(0, code, output)
        self.assertIn("ZMS  1.12.47", output)
        self.assertIn("ZTS  1.12.47", output)

    def test_show_accepts_source_tags_from_release_images(self):
        self.fixture = {"pods": [pod("1.12.48", revision="v1.12.48")]}
        code, output, calls = self.verify("--show")
        self.assertEqual(0, code, output)
        self.assertIn("✔  ZMS  1.12.48", output)
        self.assertIn("✔  ZTS  1.12.48", output)
        self.assertIn("Tag   v1.12.48", output)
        self.assertNotIn("SHA", output)
        self.assertNotIn("unknown", output)
        self.assertNotIn("⚠", output)
        self.assertTrue(all("--context" in call for call in calls[1:]))

    def test_show_preserves_custom_commit_and_build_suffix(self):
        sha = "c20293b4ba47b8eeecf21b2b98f866d01f0afc43"
        self.fixture = {"pods": [pod("1.12.47-SNAPSHOT", revision=sha + "-dirty-4a825bc609b8-build-0a3b867cbf54")]}
        code, output, _ = self.verify("--show")
        self.assertEqual(0, code, output)
        self.assertIn("✔  ZMS  1.12.47-SNAPSHOT", output)
        self.assertIn("SHA   " + sha, output)
        self.assertIn("Build dirty-4a825bc609b8-build-0a3b867cbf54", output)
        self.assertNotIn("Tag", output)

    def test_show_still_rejects_missing_or_invalid_metadata(self):
        for version, revision in (("", "v1.12.48"), ("latest", "v1.12.48"),
                                  ("1.12.48", ""), ("1.12.48", "unknown"),
                                  ("1.12.48", "v1.12.48\nunexpected")):
            with self.subTest(version=version, revision=revision):
                self.fixture = {"pods": [pod(version, revision=revision)]}
                code, output, _ = self.verify("--show")
                self.assertEqual(2, code, output)
                self.assertIn("Athenz build information is incomplete", output)


if __name__ == "__main__":
    unittest.main()
