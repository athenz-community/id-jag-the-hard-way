import copy
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


MODULE_PATH = Path(__file__).resolve().parents[1] / "athenz_version.py"
SPEC = importlib.util.spec_from_file_location("athenz_version", MODULE_PATH)
av = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = av
SPEC.loader.exec_module(av)


def schema_sql(schema="zms_server", width=128, extra=""):
    return f"""
CREATE SCHEMA IF NOT EXISTS `{schema}` DEFAULT CHARACTER SET utf8;
USE `{schema}`;
CREATE TABLE IF NOT EXISTS `{schema}`.`domain` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `account` VARCHAR({width}) NOT NULL DEFAULT '',
  {extra}
  PRIMARY KEY (`id`),
  INDEX `idx_account` (`account` ASC))
ENGINE = InnoDB;
"""


def metadata(schema="zms_server", width=128):
    common = {"schema": schema, "table": "domain"}
    return [
        dict(common, kind="table", engine="InnoDB"),
        dict(common, kind="column", name="id", type="int(10) unsigned", nullable="NO",
             default=None, extra="auto_increment", charset=None, collation=None),
        dict(common, kind="column", name="account", type=f"varchar({width})", nullable="NO",
             default="''", extra="", charset="utf8mb3", collation="utf8mb3_general_ci"),
        dict(common, kind="index", name="PRIMARY", unique=1, column="id", prefix=None, order="A"),
        dict(common, kind="index", name="idx_account", unique=0, column="account", prefix=None, order="A"),
    ]


def plan(sql, current):
    return av.plan_schema({"zms_server": av.parse_schema(sql, "zms_server")}, current)


class SchemaTests(unittest.TestCase):
    def test_matching_schema_is_noop(self):
        self.assertEqual([], plan(schema_sql(), metadata()))

    def test_adds_defaulted_column_and_nonunique_index(self):
        sql = schema_sql(extra="`client_id_self_update` TINYINT(1) NOT NULL DEFAULT 0,")
        sql = sql.replace("PRIMARY KEY", "INDEX `idx_client` (`client_id_self_update` ASC), PRIMARY KEY")
        self.assertEqual([
            "ALTER TABLE `zms_server`.`domain` ADD COLUMN `client_id_self_update` TINYINT(1) NOT NULL DEFAULT 0;",
            "ALTER TABLE `zms_server`.`domain` ADD INDEX `idx_client` (`client_id_self_update` ASC);",
        ], plan(sql, metadata()))

    def test_widens_varchar_without_changing_character_set(self):
        self.assertEqual([
            "ALTER TABLE `zms_server`.`domain` MODIFY COLUMN `account` varchar(512) CHARACTER SET utf8mb3 COLLATE utf8mb3_general_ci NOT NULL DEFAULT '';"
        ], plan(schema_sql(width=512), metadata()))

    def test_downgrade_retains_wider_and_extra_defaulted_columns(self):
        current = metadata(width=2048)
        current.append(dict(current[2], name="new_feature", type="tinyint(1)", default="0"))
        current.append(dict(current[4], name="idx_new", column="new_feature"))
        self.assertEqual([], plan(schema_sql(), current))

    def test_refuses_default_nullability_and_type_changes(self):
        for field, value in (("default", "'new'"), ("nullable", "YES"), ("type", "int(11)"), ("extra", "GENERATED")):
            with self.subTest(field=field):
                current = metadata()
                current[2][field] = value
                with self.assertRaises(av.SwitchError):
                    plan(schema_sql(), current)

    def test_refuses_missing_required_column(self):
        with self.assertRaisesRegex(av.SwitchError, "cannot safely add"):
            plan(schema_sql(extra="`required` VARCHAR(128) NOT NULL,"), metadata())

    def test_refuses_extra_required_column_on_downgrade(self):
        current = metadata()
        current.append(dict(current[2], name="required", default=None))
        with self.assertRaisesRegex(av.SwitchError, "extra required column"):
            plan(schema_sql(), current)

    def test_refuses_unique_and_foreign_key_drift(self):
        for change in ("missing_primary", "extra_unique", "different_index", "extra_foreign_key"):
            with self.subTest(change=change):
                current = metadata()
                if change == "missing_primary":
                    current.pop(3)
                elif change == "extra_unique":
                    current.append(dict(current[4], name="new_unique", unique=1))
                elif change == "different_index":
                    current[4]["prefix"] = 16
                else:
                    current.append(dict(schema="zms_server", table="domain", kind="fk", name="new_fk",
                                        column="id", ref_schema="zms_server", ref_table="other",
                                        ref_column="id", delete="RESTRICT", update="RESTRICT"))
                with self.assertRaises(av.SwitchError):
                    plan(schema_sql(), current)

    def test_creates_missing_table_but_never_runs_initialization_sql(self):
        sql = schema_sql() + "\nDROP DATABASE `zms_server`;\n"
        sql += """
CREATE TABLE IF NOT EXISTS `zms_server`.`extra` (
  `id` INT UNSIGNED NOT NULL,
  PRIMARY KEY (`id`))
ENGINE = InnoDB;
"""
        statements = plan(sql, metadata())
        self.assertEqual(1, len(statements))
        self.assertTrue(statements[0].startswith("CREATE TABLE IF NOT EXISTS `zms_server`.`extra`"))
        self.assertNotIn("DROP", statements[0])

    def test_refuses_uninitialized_database_or_unsupported_ddl(self):
        with self.assertRaisesRegex(av.SwitchError, "not initialized"):
            plan(schema_sql(), [])
        for sql in (schema_sql().replace("InnoDB", "MyISAM"),
                    schema_sql().replace("utf8;", "latin1;"),
                    schema_sql(extra="`injected` INT DEFAULT 0; DROP TABLE domain; --,")):
            with self.subTest(sql=sql), self.assertRaises(av.SwitchError):
                av.parse_schema(sql, "zms_server")

    def test_mariadb_text_size_and_timestamp_normalization(self):
        sql = schema_sql(extra="`key_value` TEXT(65535) NOT NULL, `created` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,")
        current = metadata()
        current.extend([
            dict(current[2], name="key_value", type="mediumtext", default=None),
            dict(current[2], name="created", type="datetime", default="current_timestamp()", extra="on update current_timestamp()"),
        ])
        self.assertEqual([], plan(sql, current))

    def test_explicit_collation_is_checked_and_preserved_when_widening(self):
        sql = schema_sql(width=512).replace("VARCHAR(512)", "VARCHAR(512) CHARACTER SET 'utf8' COLLATE 'utf8_bin'")
        current = metadata()
        current[2]["collation"] = "utf8mb3_bin"
        statements = plan(sql, current)
        self.assertEqual(1, len(statements))
        self.assertEqual(1, statements[0].count("CHARACTER SET"))
        self.assertIn("COLLATE utf8mb3_bin", statements[0])
        current[2]["collation"] = "utf8mb3_general_ci"
        with self.assertRaisesRegex(av.SwitchError, "collation differs"):
            plan(sql, current)

    def test_quoted_commas_and_index_prefixes(self):
        sql = schema_sql(extra="`commented` VARCHAR(32) NOT NULL DEFAULT 'can''t, split' COMMENT 'one, two',")
        sql = sql.replace("(`account` ASC)", "(`account`(32) ASC)")
        table = av.parse_schema(sql, "zms_server")["domain"]
        self.assertEqual("'can''t, split'", table.columns["commented"].default)
        self.assertEqual((("account", 32, "ASC"),), table.indexes["idx_account"][1])


class LatestVersionTests(unittest.TestCase):
    def test_selects_highest_stable_tag_numerically(self):
        for tags, expected in (
            ("v1.12.9\nv1.12.48\nv1.12.10\nv1.12.49-SNAPSHOT\nv2.0.0-rc.1\nlatest\n", "1.12.48"),
            ("v1.12.99\nv1.13.0\nv1.9.100\n", "1.13.0"),
            ("v1.99.99\nv2.0.0\nv02.1.0\n2.1.0\nv3.0.0+build\n", "2.0.0"),
        ):
            with self.subTest(tags=tags), patch.object(av, "run", return_value=tags) as run:
                self.assertEqual(expected, av.latest_version())
                self.assertIn("--paginate", run.call_args.args)

    def test_no_stable_tags_is_an_error(self):
        with patch.object(av, "run", return_value="latest\nv1.12.49-SNAPSHOT\n"):
            with self.assertRaisesRegex(av.SwitchError, "No stable Athenz release tags"):
                av.latest_version()

    def test_lookup_failure_is_not_silently_replaced_with_a_version(self):
        with patch.object(av, "run", side_effect=av.SwitchError("GitHub unavailable")):
            with self.assertRaisesRegex(av.SwitchError, "GitHub unavailable"):
                av.latest_version()


class FakeCommands:
    def __init__(self):
        self.calls = []
        self.context = "kind-kind"
        self.loaded = False
        self.applied = False
        self.patched = []
        self.fail_pull = False
        self.fail_sql = False
        self.fail_rollout = False
        self.label_version = "1.12.48"
        self.reported_version = "1.12.48"
        self.db_changed = False
        self.deployment_changed = False
        self.tags = "v1.12.48\nv1.12.47\n"
        self.before = metadata() + metadata("zts_store")
        self.after = metadata(width=512) + metadata("zts_store")

    def __call__(self, *args, input=None):
        self.calls.append((args, input))
        if args[:3] == ("kubectl", "config", "current-context"):
            return self.context + "\n"
        if args[0] == "gh":
            if "repos/AthenZ/athenz/tags?per_page=100" in args:
                return self.tags
            return schema_sql(width=512) if "/zms/" in args[-1] else schema_sql("zts_store")
        if args[0] == "make" and "load-docker-images-internal" in args:
            if self.fail_pull:
                raise av.SwitchError("image unavailable")
            return "pulled\n"
        if args[0] == "make" and "build" in args:
            return "built\n"
        if args[0] == "git":
            return "distribution-commit\n" if "rev-parse" in args else ""
        if args[:3] == ("docker", "image", "inspect"):
            return self.label_version + "\n"
        if args[0] == "make" and "kind-load-images-internal" in args:
            self.loaded = True
            return ""
        if args[0] != "kubectl":
            raise AssertionError(args)
        self.assert_context(args)
        command = args[args.index("-n") + 2:]
        if command[:2] == ("get", "deployment"):
            component = command[2]
            rv = "11" if self.loaded and self.deployment_changed else "10"
            result = f"{rv}\t1\ncontainers\t{component}\tlocal/{component}:custom\n"
            if component == "athenz-zms-server":
                result += "initContainers\tathenz-zms-server-wait\tghcr.io/ctyano/athenz-zms-server:latest\n"
            if component == "athenz-zts-server":
                result += "initContainers\tzms-cli\tghcr.io/ctyano/athenz-cli:latest\n"
                result += "initContainers\tathenz-conf\tghcr.io/ctyano/athenz-cli:latest\n"
                result += "initContainers\tlocal-plugin\tghcr.io/example/plugin:custom\n"
            return result
        if command[:2] == ("get", "pods"):
            component = command[3].split("=", 1)[1]
            uid = "different" if component == "athenz-db" and self.loaded and self.db_changed else "uid"
            return f"{component}-pod|{uid}||Running|true\n"
        if command[0] == "exec":
            if command[-2:] == ("printenv", "VERSION"):
                component = command[command.index("-c") + 1]
                return self.reported_version if component in self.patched else "1.12.47-SNAPSHOT"
            if "sh" in command:
                return "registered-zms-id\nregistered-zms-id\nregistered-zms-id\n"
            if input == av.METADATA_SQL:
                return "\n".join(json.dumps(row) for row in (self.after if self.applied else self.before))
            if input and input.startswith("SET SESSION"):
                if self.fail_sql:
                    raise av.SwitchError("DDL failed")
                self.applied = True
                return ""
        if command[0] == "patch":
            self.patched.append(command[2])
            return "patched\n"
        if command[:2] == ("rollout", "status"):
            if self.fail_rollout and command[2] == "deployment/athenz-zms-server":
                raise av.SwitchError("rollout timed out")
            return "ready\n"
        raise AssertionError((command, input))

    @staticmethod
    def assert_context(args):
        assert args[1:3] == ("--context", "kind-kind"), args


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.commands = FakeCommands()
        self.patches = [patch.object(av, "run", self.commands),
                        patch.object(av.shutil, "which", return_value="/fake/bin"),
                        patch.object(av.os, "environ", {}), patch.object(av, "emit")]
        for mocked in self.patches:
            mocked.start()
            self.addCleanup(mocked.stop)

    def test_dry_run_has_no_mutations(self):
        av.switch("1.12.48", True)
        self.assertFalse(self.commands.loaded)
        self.assertFalse(self.commands.applied)
        self.assertEqual([], self.commands.patched)
        self.assertTrue(all(args[0] in ("kubectl", "gh") for args, _ in self.commands.calls))

    def test_latest_resolves_once_and_pins_schema_images_and_rollout(self):
        self.assertEqual(0, av.main(["latest"]))
        tag_queries = [args for args, _ in self.commands.calls
                       if "repos/AthenZ/athenz/tags?per_page=100" in args]
        self.assertEqual(1, len(tag_queries))
        schemas = [args[-1] for args, _ in self.commands.calls
                   if args[0] == "gh" and "/schema/" in args[-1]]
        self.assertEqual(2, len(schemas))
        self.assertTrue(all(endpoint.endswith("?ref=v1.12.48") for endpoint in schemas))
        for args, _ in self.commands.calls:
            if args[0] == "make":
                self.assertIn("VERSION=1.12.48", args)
                self.assertIn("ATHENZ_IMAGE_TAG=v1.12.48", args)
            if "patch" in args:
                spec = json.loads(args[-1])["spec"]["template"]["spec"]
                self.assertTrue(all(container["image"].endswith(":v1.12.48")
                                    for containers in spec.values() for container in containers))
        self.assertEqual(list(av.COMPONENTS), self.commands.patched)

    def test_latest_lookup_errors_stop_before_schema_and_deployment_changes(self):
        for error in ("No stable Athenz release tags found on GitHub", "GitHub unavailable"):
            with self.subTest(error=error), patch.object(av, "latest_version", side_effect=av.SwitchError(error)):
                self.commands.calls.clear()
                self.assertEqual(1, av.main(["latest"]))
                self.assertEqual([(("kubectl", "config", "current-context"), None)], self.commands.calls)

    def test_latest_dry_run_does_not_load_images_or_mutate(self):
        self.assertEqual(0, av.main(["latest", "--dry-run"]))
        self.assertFalse(self.commands.loaded)
        self.assertFalse(self.commands.applied)
        self.assertEqual([], self.commands.patched)
        self.assertTrue(all(args[0] in ("kubectl", "gh") for args, _ in self.commands.calls))

    def test_release_switch_updates_init_images_and_preserves_signing_ids(self):
        av.switch("1.12.48", False)
        self.assertTrue(self.commands.applied)
        self.assertEqual(list(av.COMPONENTS), self.commands.patched)
        patches = {args[args.index("deployment") + 1]: json.loads(args[-1])
                   for args, _ in self.commands.calls if "patch" in args}
        zms = patches["athenz-zms-server"]["spec"]["template"]["spec"]
        self.assertEqual("registered-zms-id", zms["containers"][0]["env"][0]["value"])
        self.assertIsNone(zms["containers"][0]["env"][0]["valueFrom"])
        self.assertEqual("ghcr.io/ctyano/athenz-zms-server:v1.12.48", zms["initContainers"][0]["image"])
        zts = patches["athenz-zts-server"]["spec"]["template"]["spec"]
        self.assertEqual(["zms-cli", "athenz-conf"], [item["name"] for item in zts["initContainers"]])
        self.assertNotIn("athenz-db", patches)
        mutation = next(i for i, (_, data) in enumerate(self.commands.calls) if data and data.startswith("SET SESSION"))
        self.assertTrue(any("kind-load-images-internal" in args for args, _ in self.commands.calls[:mutation]))
        prepare = next(args for args, _ in self.commands.calls if "load-docker-images-internal" in args)
        self.assertIn(str(av.DIST), prepare)
        self.assertIn("ATHENZ_IMAGE_TAG=v1.12.48", prepare)
        self.assertIn("TRACKING_GIT_FORCE_CHECKOUT=false", prepare)

    def test_rebuild_reuses_distribution_in_an_isolated_checkout(self):
        with patch.object(av.os, "environ", {"REBUILD": "true"}):
            self.assertEqual(0, av.main(["1.12.48"]))
        builds = [args for args, _ in self.commands.calls if args[0] == "make" and "build" in args]
        self.assertEqual(1, len(builds))
        self.assertNotEqual(str(av.DIST), builds[0][builds[0].index("-C") + 1])
        self.assertIn("VERSION=1.12.48", builds[0])
        self.assertIn("PUSH=false", builds[0])
        self.assertIn("TRACKING_GIT_FORCE_CHECKOUT=false", builds[0])
        checkouts = [args for args, _ in self.commands.calls if args[0] == "git" and "checkout" in args]
        self.assertTrue(checkouts)
        self.assertTrue(all(str(av.DIST) not in args for args in checkouts))
        source_clones = [args for args, _ in self.commands.calls
                         if args[:2] == ("git", "clone") and str(av.DIST / "athenz") in args]
        self.assertTrue(all("--no-checkout" not in args for args in source_clones))
        self.assertFalse(any("load-docker-images-internal" in args for args, _ in self.commands.calls))

    def test_rebuild_preview_does_not_build_or_clone(self):
        av.switch("1.12.48", True, rebuild=True)
        self.assertFalse(any(args[0] in ("git", "make", "docker") for args, _ in self.commands.calls))
        self.assertFalse(self.commands.applied)

    def test_incompatible_schema_stops_before_pulling_or_mutating(self):
        self.commands.before[2]["type"] = "int(11)"
        with self.assertRaises(av.SwitchError):
            av.switch("1.12.48", False)
        self.assertFalse(any(args[0] == "docker" for args, _ in self.commands.calls))
        self.assertEqual([], self.commands.patched)

    def test_unavailable_or_mislabeled_images_stop_before_sql(self):
        for setting, value in (("fail_pull", True), ("label_version", "1.12.47")):
            with self.subTest(setting=setting):
                self.commands.fail_pull = False
                self.commands.label_version = "1.12.48"
                setattr(self.commands, setting, value)
                with self.assertRaises(av.SwitchError):
                    av.switch("1.12.48", False)
                self.assertFalse(self.commands.applied)
                self.assertEqual([], self.commands.patched)

    def test_concurrent_db_or_deployment_change_stops_before_sql(self):
        for setting in ("db_changed", "deployment_changed"):
            with self.subTest(setting=setting):
                self.commands.loaded = False
                self.commands.db_changed = False
                self.commands.deployment_changed = False
                setattr(self.commands, setting, True)
                with self.assertRaises(av.SwitchError):
                    av.switch("1.12.48", False)
                self.assertFalse(self.commands.applied)
                self.assertEqual([], self.commands.patched)

    def test_sql_failure_stops_before_deployment_changes(self):
        self.commands.fail_sql = True
        with self.assertRaisesRegex(av.SwitchError, "DDL failed"):
            av.switch("1.12.48", False)
        self.assertEqual([], self.commands.patched)

    def test_retry_uses_live_schema_and_does_not_repeat_ddl(self):
        self.commands.before = copy.deepcopy(self.commands.after)
        av.switch("1.12.48", False)
        self.assertFalse(self.commands.applied)
        self.assertEqual(list(av.COMPONENTS), self.commands.patched)

    def test_rollout_failure_stops_later_components(self):
        self.commands.fail_rollout = True
        with self.assertRaisesRegex(av.SwitchError, "rollout timed out"):
            av.switch("1.12.48", False)
        self.assertEqual(["athenz-cli", "athenz-zms-server"], self.commands.patched)

    def test_final_version_must_match_exactly(self):
        self.commands.reported_version = "1.12.48-SNAPSHOT"
        with self.assertRaisesRegex(av.SwitchError, "expected 1.12.48"):
            av.switch("1.12.48", False)

    def test_nonlocal_context_is_rejected(self):
        self.commands.context = "production"
        with self.assertRaisesRegex(av.SwitchError, "local kind context"):
            av.switch("1.12.48", True)
        self.assertEqual(1, len(self.commands.calls))

    def test_invalid_arguments_do_not_contact_cluster(self):
        for version in ("", "vlatest", "LATEST", "1.12.48-SNAPSHOT", "1.2.3; echo bad", "../1.2.3"):
            with self.subTest(version=version):
                self.assertEqual(2, av.main([version]))
        self.assertEqual([], self.commands.calls)

    def test_v_prefix_and_dry_run_environment(self):
        with patch.object(av.os, "environ", {"DRY_RUN": "true"}):
            self.assertEqual(0, av.main(["v1.12.48"]))
        self.assertFalse(self.commands.loaded)
        self.assertFalse(self.commands.applied)


if __name__ == "__main__":
    unittest.main()
