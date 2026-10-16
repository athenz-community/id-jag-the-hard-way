#!/usr/bin/env python3
"""Switch an existing local IDTHW installation without replacing its DB pod.

Only schema metadata is read from MariaDB. The planner accepts additive changes
and VARCHAR widening; it never runs an upstream initialization/migration script.
"""

import argparse
from dataclasses import dataclass, field
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile


REGISTRY = "ghcr.io/ctyano"
DIST = Path(__file__).resolve().parents[2] / "athenz_dist"
SCHEMAS = ("zms_server", "zts_store")
COMPONENTS = ("athenz-cli", "athenz-zms-server", "athenz-zts-server", "athenz-ui")
KEY_IDS = ("ZMS_PRIVATE_KEY_ID", "ZMS_RSA_PRIVATE_KEY_ID", "ZMS_EC_PRIVATE_KEY_ID")
RELEASE_VERSION = re.compile(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)")
IDENTIFIER = r"[A-Za-z_][A-Za-z0-9_]*"
SQL_IDENTIFIER = rf"(?:{IDENTIFIER}|'{IDENTIFIER}')"
QUOTED = r"'(?:''|[^'\\])*'"
DEFAULT = rf"(?:{QUOTED}|-?\d+|NULL|CURRENT_TIMESTAMP(?:\(\d*\))?)"
COLUMN = re.compile(
    rf"`(?P<name>{IDENTIFIER})`\s+"
    r"(?P<type>(?:VARCHAR\(\d+\)|CHAR\(\d+\)|(?:TINYINT|SMALLINT|INT|BIGINT)(?:\(\d+\))?"
    r"(?: UNSIGNED)?|(?:DATETIME|TIMESTAMP)(?:\(\d+\))?|TEXT(?:\(\d+\))?|MEDIUMTEXT|LONGTEXT))"
    rf"(?:\s+CHARACTER SET\s+(?P<charset>{SQL_IDENTIFIER}))?"
    rf"(?:\s+COLLATE\s+(?P<collation>{SQL_IDENTIFIER}))?"
    r"(?:\s+(?P<null>NOT NULL|NULL))?"
    rf"(?:\s+DEFAULT\s+(?P<default>{DEFAULT}))?"
    r"(?:\s+(?P<extra>AUTO_INCREMENT|ON UPDATE CURRENT_TIMESTAMP(?:\(\d*\))?))?"
    rf"(?:\s+COMMENT\s+{QUOTED})?",
    re.IGNORECASE,
)


class SwitchError(Exception):
    pass


def emit(level, message):
    for line in str(message).splitlines():
        print(f"{level}\t{line}", flush=True)


def run(*args, input=None):
    result = subprocess.run(args, input=input, text=True, capture_output=True)
    if result.returncode:
        # These commands select only schema/build metadata, never Secrets or rows.
        raise SwitchError(f"{args[0]} failed: {result.stderr.strip() or result.stdout.strip()}")
    return result.stdout


def latest_version():
    tags = run("gh", "api", "--hostname", "github.com", "--paginate",
               "repos/AthenZ/athenz/tags?per_page=100", "--jq", ".[].name")
    versions = [tag[1:] for tag in tags.splitlines()
                if tag.startswith("v") and RELEASE_VERSION.fullmatch(tag[1:])]
    if not versions:
        raise SwitchError("No stable Athenz release tags found on GitHub")
    return max(versions, key=lambda version: tuple(map(int, version.split("."))))


def split_definitions(body):
    """Split table clauses without splitting quoted comments or index columns."""
    parts, start, depth, quote = [], 0, 0, None
    for pos, char in enumerate(body):
        if quote:
            if char == quote:
                quote = None
        elif char in "'`":
            quote = char
        elif char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
        elif char == "," and depth == 0:
            parts.append(body[start:pos].strip())
            start = pos + 1
        if depth < 0:
            raise SwitchError("Unsupported schema syntax")
    if quote or depth:
        raise SwitchError("Unbalanced schema definition")
    return parts + [body[start:].strip()]


def normalize_type(value):
    value = value.lower()
    text_width = re.fullmatch(r"text\((\d+)\)", value)
    if text_width:
        # Athenz declares utf8 schemas. MariaDB chooses TEXT's storage class
        # using the maximum byte length, so TEXT(65535) becomes MEDIUMTEXT.
        size = int(text_width[1]) * 3
        for limit, name in ((255, "tinytext"), (65535, "text"), (16777215, "mediumtext"), (4294967295, "longtext")):
            if size <= limit:
                return name
        raise SwitchError("Unsupported TEXT size")
    return re.sub(r"\b(tinyint|smallint|int|bigint)\(\d+\)", r"\1", value)


def normalize_default(value):
    if value is None or value.upper() == "NULL":
        return None
    if value.startswith("'"):
        return value
    return value.lower().replace("current_timestamp()", "current_timestamp")


def normalize_extra(value):
    return value.lower().replace("current_timestamp()", "current_timestamp")


@dataclass
class Column:
    name: str
    type: str
    nullable: bool
    default: str | None
    extra: str
    sql: str
    charset: str | None = None
    collation: str | None = None


@dataclass
class Table:
    schema: str
    name: str
    sql: str
    columns: dict = field(default_factory=dict)
    indexes: dict = field(default_factory=dict)
    foreign_keys: dict = field(default_factory=dict)


def index_columns(value):
    columns = []
    for part in split_definitions(value):
        match = re.fullmatch(rf"`({IDENTIFIER})`(?:\((\d+)\))?(?:\s+(ASC|DESC))?", part)
        if not match:
            raise SwitchError(f"Unsupported index column: {part}")
        name, prefix, order = match.groups()
        columns.append((name, int(prefix) if prefix else None, order or "ASC"))
    return tuple(columns)


def parse_schema(sql, expected_schema):
    tables = {}
    if not re.search(rf"CREATE SCHEMA IF NOT EXISTS `{expected_schema}` DEFAULT CHARACTER SET utf8(?:mb3)?\s*;", sql):
        raise SwitchError(f"{expected_schema}: expected the upstream utf8 schema")
    pattern = rf"CREATE TABLE IF NOT EXISTS `({IDENTIFIER})`\.`({IDENTIFIER})`\s*\((.*?)\)\s*ENGINE\s*=\s*InnoDB\s*;"
    matches = list(re.finditer(pattern, sql, re.DOTALL))
    if len(matches) != len(re.findall(r"\bCREATE TABLE\b", sql)) or not matches:
        raise SwitchError("Unsupported or empty upstream table definitions")
    for match in matches:
        schema, name, body = match.groups()
        if schema != expected_schema or name in tables:
            raise SwitchError("Unexpected schema or duplicate table")
        table = Table(schema, name, match.group())
        for definition in split_definitions(body):
            column = COLUMN.fullmatch(definition)
            index = re.fullmatch(rf"(?:(PRIMARY KEY)|(?:(UNIQUE )?INDEX `({IDENTIFIER})`))\s*\((.*)\)", definition)
            foreign = re.fullmatch(
                rf"CONSTRAINT `({IDENTIFIER})`\s+FOREIGN KEY \((.*?)\)\s+"
                rf"REFERENCES `({IDENTIFIER})`\.`({IDENTIFIER})` \((.*?)\)\s+"
                r"ON DELETE (NO ACTION|RESTRICT|CASCADE|SET NULL)\s+ON UPDATE (NO ACTION|RESTRICT|CASCADE|SET NULL)",
                definition,
                re.DOTALL,
            )
            if column:
                data = column.groupdict()
                if data["name"] in table.columns:
                    raise SwitchError("Duplicate column")
                table.columns[data["name"]] = Column(
                    data["name"], normalize_type(data["type"]), (data["null"] or "").upper() != "NOT NULL",
                    normalize_default(data["default"]), normalize_extra(data["extra"] or ""), definition,
                    data["charset"].strip("'") if data["charset"] else None,
                    data["collation"].strip("'") if data["collation"] else None,
                )
            elif index:
                primary, unique, index_name, columns = index.groups()
                table.indexes[index_name or "PRIMARY"] = (bool(primary or unique), index_columns(columns), definition)
            elif foreign:
                fk_name, columns, ref_schema, ref_table, ref_columns, delete, update = foreign.groups()
                if ref_schema != expected_schema:
                    raise SwitchError("Cross-schema foreign keys require manual migration")
                table.foreign_keys[fk_name] = (
                    tuple(c[0] for c in index_columns(columns)), ref_schema, ref_table,
                    tuple(c[0] for c in index_columns(ref_columns)), delete, update,
                )
            else:
                raise SwitchError(f"Unsupported definition in {schema}.{name}: {definition}")
        tables[name] = table
    return tables


# Each result is one JSON object. This reads information_schema, never Athenz data.
METADATA_SQL = """
SELECT JSON_OBJECT('kind', 'table', 'schema', TABLE_SCHEMA, 'table', TABLE_NAME, 'engine', ENGINE)
FROM information_schema.TABLES WHERE TABLE_SCHEMA IN ('zms_server', 'zts_store');
SELECT JSON_OBJECT('kind', 'column', 'schema', TABLE_SCHEMA, 'table', TABLE_NAME,
 'name', COLUMN_NAME, 'type', COLUMN_TYPE, 'nullable', IS_NULLABLE, 'default', COLUMN_DEFAULT,
 'extra', EXTRA, 'charset', CHARACTER_SET_NAME, 'collation', COLLATION_NAME)
FROM information_schema.COLUMNS WHERE TABLE_SCHEMA IN ('zms_server', 'zts_store');
SELECT JSON_OBJECT('kind', 'index', 'schema', TABLE_SCHEMA, 'table', TABLE_NAME,
 'name', INDEX_NAME, 'unique', 1 - NON_UNIQUE, 'column', COLUMN_NAME,
 'position', SEQ_IN_INDEX, 'prefix', SUB_PART, 'order', COLLATION)
FROM information_schema.STATISTICS WHERE TABLE_SCHEMA IN ('zms_server', 'zts_store')
ORDER BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;
SELECT JSON_OBJECT('kind', 'fk', 'schema', k.TABLE_SCHEMA, 'table', k.TABLE_NAME,
 'name', k.CONSTRAINT_NAME, 'column', k.COLUMN_NAME, 'ref_schema', k.REFERENCED_TABLE_SCHEMA,
 'ref_table', k.REFERENCED_TABLE_NAME, 'ref_column', k.REFERENCED_COLUMN_NAME,
 'delete', r.DELETE_RULE, 'update', r.UPDATE_RULE)
FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r
 ON k.CONSTRAINT_SCHEMA = r.CONSTRAINT_SCHEMA AND k.TABLE_NAME = r.TABLE_NAME
 AND k.CONSTRAINT_NAME = r.CONSTRAINT_NAME
WHERE k.TABLE_SCHEMA IN ('zms_server', 'zts_store')
ORDER BY k.TABLE_SCHEMA, k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION;
"""


def plan_schema(targets, metadata):
    current = {}
    for row in metadata:
        table = current.setdefault((row["schema"], row["table"]), {"column": {}, "index": {}, "fk": {}})
        if row["kind"] == "table":
            table["engine"] = row["engine"]
        elif row["kind"] == "column":
            table["column"][row["name"]] = row
        else:
            table[row["kind"]].setdefault(row["name"], []).append(row)
    statements = []
    for schema, tables in targets.items():
        if not any(key[0] == schema for key in current):
            raise SwitchError(f"{schema} is not initialized; set up IDTHW first")
        for name, target in tables.items():
            qualified = f"`{schema}`.`{name}`"
            live = current.get((schema, name))
            if live is None:
                statements.append(target.sql)
                continue
            if live.get("engine") != "InnoDB":
                raise SwitchError(f"{qualified}: expected an InnoDB table")
            for col_name, column in target.columns.items():
                actual = live["column"].get(col_name)
                if actual is None:
                    if (not column.nullable and column.default is None) or column.extra:
                        raise SwitchError(f"{qualified}.{col_name}: cannot safely add a required/generated column")
                    statements.append(f"ALTER TABLE {qualified} ADD COLUMN {column.sql};")
                    continue
                if ((actual["nullable"] == "YES") != column.nullable
                        or normalize_default(actual["default"]) != column.default
                        or normalize_extra(actual["extra"]) != column.extra):
                    raise SwitchError(f"{qualified}.{col_name}: default, nullability or generated value differs; manual migration required")
                for attribute in ("charset", "collation"):
                    expected = getattr(column, attribute)
                    if expected and expected.replace("utf8mb3", "utf8") != (actual[attribute] or "").replace("utf8mb3", "utf8"):
                        raise SwitchError(f"{qualified}.{col_name}: {attribute} differs; manual migration required")
                actual_type = normalize_type(actual["type"])
                if actual_type == column.type:
                    continue
                wanted_width = re.fullmatch(r"varchar\((\d+)\)", column.type)
                live_width = re.fullmatch(r"varchar\((\d+)\)", actual_type)
                if not wanted_width or not live_width:
                    raise SwitchError(f"{qualified}.{col_name}: incompatible types ({actual_type} / {column.type})")
                if int(live_width[1]) < int(wanted_width[1]):
                    charset, collation = actual["charset"], actual["collation"]
                    if not all(value and re.fullmatch(IDENTIFIER, value) for value in (charset, collation)):
                        raise SwitchError(f"{qualified}.{col_name}: unsupported character set")
                    # Retain the live character set when widening a column.
                    definition = re.sub(rf"VARCHAR\(\d+\)(?:\s+CHARACTER SET {SQL_IDENTIFIER})?(?:\s+COLLATE {SQL_IDENTIFIER})?",
                                        f"{column.type} CHARACTER SET {charset} COLLATE {collation}",
                                        column.sql, count=1, flags=re.IGNORECASE)
                    statements.append(f"ALTER TABLE {qualified} MODIFY COLUMN {definition};")
            for col_name, actual in live["column"].items():
                if (col_name not in target.columns and actual["nullable"] != "YES"
                        and normalize_default(actual["default"]) is None and actual["extra"] != "auto_increment"):
                    raise SwitchError(f"{qualified}.{col_name}: extra required column prevents a compatible downgrade")
            for index_name, (unique, columns, definition) in target.indexes.items():
                actual = live["index"].get(index_name)
                if actual is None:
                    if unique:
                        raise SwitchError(f"{qualified}.{index_name}: missing primary/unique key; manual migration required")
                    statements.append(f"ALTER TABLE {qualified} ADD {definition};")
                elif (bool(actual[0]["unique"]) != unique or tuple(
                        (row["column"], row["prefix"], "DESC" if row["order"] == "D" else "ASC")
                        for row in actual) != columns):
                    raise SwitchError(f"{qualified}.{index_name}: index definition differs; manual migration required")
            if any(rows[0]["unique"] for key, rows in live["index"].items() if key not in target.indexes):
                raise SwitchError(f"{qualified}: extra unique key may reject writes by the requested release")
            foreign_keys = {
                key: (tuple(row["column"] for row in rows), rows[0]["ref_schema"], rows[0]["ref_table"],
                      tuple(row["ref_column"] for row in rows), rows[0]["delete"], rows[0]["update"])
                for key, rows in live["fk"].items()
            }
            # MariaDB reports NO ACTION as RESTRICT; both mean immediate checking.
            normalize_fk = lambda value: tuple("RESTRICT" if part == "NO ACTION" else part for part in value)
            if ({key: normalize_fk(value) for key, value in foreign_keys.items()}
                    != {key: normalize_fk(value) for key, value in target.foreign_keys.items()}):
                raise SwitchError(f"{qualified}: foreign keys differ; manual migration required")
    return statements


INVENTORY_QUERY = (
    '{.metadata.resourceVersion}{"\\t"}{.spec.replicas}{"\\n"}'
    '{range .spec.template.spec.containers[*]}{"containers\\t"}{.name}{"\\t"}{.image}{"\\n"}{end}'
    '{range .spec.template.spec.initContainers[*]}{"initContainers\\t"}{.name}{"\\t"}{.image}{"\\n"}{end}'
)


class Installation:
    def __init__(self, context):
        self.context = context

    def kubectl(self, *args, input=None):
        return run("kubectl", "--context", self.context, "--request-timeout=15s", "-n", "athenz", *args, input=input)

    def ready_pods(self, component):
        query = ('{range .items[*]}{.metadata.name}{"|"}{.metadata.uid}{"|"}{.metadata.deletionTimestamp}'
                 '{"|"}{.status.phase}{"|"}{.status.containerStatuses[?(@.name=="' + component + '")].ready}{"\\n"}{end}')
        rows = self.kubectl("get", "pods", "-l", f"app.kubernetes.io/name={component}", f"-o=jsonpath={query}")
        pods = []
        for row in rows.splitlines():
            name, uid, deleting, phase, ready = row.split("|")
            if deleting:
                continue
            if phase != "Running" or ready != "true":
                raise SwitchError(f"{component}: {name} is not ready")
            pods.append((name, uid))
        if not pods:
            raise SwitchError(f"No ready {component} pods")
        return pods

    def metadata(self, db_pod):
        return [json.loads(line) for line in self.sql(db_pod, METADATA_SQL).splitlines() if line]

    def sql(self, db_pod, sql):
        return self.kubectl("exec", "-i", db_pod, "-c", "athenz-db", "--", "mariadb",
                            "--no-defaults", "--user=root", "--batch", "--raw", "--skip-column-names", input=sql)

    def inventory(self):
        deployments = {}
        for component in COMPONENTS:
            output = self.kubectl("get", "deployment", component, "--ignore-not-found", f"-o=jsonpath={INVENTORY_QUERY}")
            if not output:
                if component in ("athenz-zms-server", "athenz-zts-server"):
                    raise SwitchError(f"Missing deployment/{component}; set up IDTHW first")
                continue
            lines = output.splitlines()
            resource_version, replicas = lines[0].split("\t")
            if replicas != "1":
                raise SwitchError(f"{component}: this local helper requires one replica")
            containers = [line.split("\t") for line in lines[1:]]
            if not any(group == "containers" and name == component for group, name, _ in containers):
                raise SwitchError(f"{component}: expected server container is missing")
            deployments[component] = (resource_version, containers)
        return deployments

    def versions(self, expected=None):
        pods = {}
        for component in ("athenz-zms-server", "athenz-zts-server"):
            pods[component] = self.ready_pods(component)
            for pod, _ in pods[component]:
                version = self.kubectl("exec", pod, "-c", component, "--", "printenv", "VERSION").strip()
                if not re.fullmatch(r"v?\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.+-]+)?", version):
                    raise SwitchError(f"{pod}: missing or unsupported build VERSION")
                if expected and version.removeprefix("v") != expected:
                    raise SwitchError(f"{pod}: expected {expected}, got {version}")
                emit("info", f"{component}: {version}")
        return pods


def deployment_patches(inventory, version, key_ids):
    patches, images = {}, set()
    for component, (resource_version, containers) in inventory.items():
        spec = {}
        for group, name, old_image in containers:
            image_component = old_image.rsplit("/", 1)[-1].split(":", 1)[0].split("@", 1)[0]
            if group == "containers" and name == component:
                image_component = component
            if image_component not in COMPONENTS:
                continue
            image = f"{REGISTRY}/{image_component}:v{version}"
            images.add(image)
            container = {"name": name, "image": image, "imagePullPolicy": "IfNotPresent"}
            if component == "athenz-zms-server" and group == "containers" and name == component:
                # Keep the already registered signing IDs across a pod rename.
                # No key/certificate contents are read, copied or re-registered.
                container["env"] = [{"name": key, "value": value, "valueFrom": None} for key, value in key_ids.items()]
            spec.setdefault(group, []).append(container)
        patches[component] = {"metadata": {"resourceVersion": resource_version}, "spec": {"template": {"spec": spec}}}
    return patches, sorted(images)


def distribution_options(version):
    return [f"VERSION={version}", f"ATHENZ_IMAGE_TAG=v{version}", f"DOCKER_TAG=:v{version}",
            f"DOCKER_REGISTRY={REGISTRY}/", "TRACKING_GIT_REPO=AthenZ/athenz",
            "TRACKING_GIT_URL=https://github.com/AthenZ/athenz.git", "TRACKING_GIT_REF=",
            "TRACKING_GIT_BRANCH=", "TRACKING_GIT_FORCE_CHECKOUT=false", "PUSH=false",
            "LATEST_DOCKER_TAG_OPTION="]


def prepare_images(version, rebuild):
    """Reuse the distribution's image targets without editing its source tree."""
    options = distribution_options(version)
    if not rebuild:
        emit("info", "Preparing release images with athenz_dist: load-docker-images-internal")
        run("make", "--no-print-directory", "-C", str(DIST), "load-docker-images-internal", *options)
        return
    emit("info", "Rebuilding with athenz_dist: build (isolated temporary checkout)")
    revision = run("git", "-C", str(DIST), "rev-parse", "HEAD").strip()
    # The distribution's build applies POM/source overlays. A fresh checkout
    # avoids carrying these patches between versions or discarding local edits.
    with tempfile.TemporaryDirectory(prefix="idthw-athenz-build-") as temporary:
        build_dir = Path(temporary) / "athenz_dist"
        run("git", "clone", "--shared", "--no-checkout", str(DIST), str(build_dir))
        run("git", "-C", str(build_dir), "checkout", "--detach", revision)
        if (DIST / "athenz" / ".git").exists():
            # checkout-source checks for a clean tree before selecting the tag.
            run("git", "clone", "--shared", str(DIST / "athenz"), str(build_dir / "athenz"))
        run("make", "--no-print-directory", "-C", str(build_dir), "build", *options)


def switch(version, dry_run, rebuild=False):
    for command in ("kubectl", "gh") + (() if dry_run else ("make", "docker", "kind")) + (("git",) if rebuild and not dry_run else ()):
        if not shutil.which(command):
            raise SwitchError(f"{command} is required")
    if not (DIST / "Makefile").is_file():
        raise SwitchError("Initialize the athenz_dist submodule first")
    context = run("kubectl", "config", "current-context").strip()
    if not context.startswith("kind-") or len(context) == 5:
        raise SwitchError(f"Select the local kind context first (current context: {context or 'none'})")
    cluster = context[5:]
    if os.environ.get("KIND_CLUSTER") and os.environ["KIND_CLUSTER"] != cluster:
        raise SwitchError("KIND_CLUSTER does not match the current kubectl context")
    if version == "latest":
        version = latest_version()
        emit("info", f"Latest stable Athenz tag: v{version}")
    installation = Installation(context)
    emit("info", f"Planning Athenz {version} in {context}/athenz")
    inventory = installation.inventory()
    pods = installation.versions()
    if len(pods["athenz-zms-server"]) != 1:
        raise SwitchError("Wait for the current ZMS rollout to finish")
    identifiers = installation.kubectl(
        "exec", pods["athenz-zms-server"][0][0], "-c", "athenz-zms-server", "--", "sh", "-c",
        'printf "%s\\n" "${ZMS_PRIVATE_KEY_ID:-}" "${ZMS_RSA_PRIVATE_KEY_ID:-}" "${ZMS_EC_PRIVATE_KEY_ID:-}"',
    ).splitlines()
    if len(identifiers) != len(KEY_IDS):
        raise SwitchError("Could not determine the existing ZMS signing key IDs")
    key_ids = dict((key, value) for key, value in zip(KEY_IDS, identifiers) if value)
    if not key_ids or any(not re.fullmatch(r"[A-Za-z0-9_.:-]+", value) for value in key_ids.values()):
        raise SwitchError("ZMS must have explicit signing key IDs before switching versions")
    db_pods = installation.ready_pods("athenz-db")
    if len(db_pods) != 1:
        raise SwitchError("Expected exactly one local Athenz DB pod")
    targets = {}
    for component, schema in zip(("zms", "zts"), SCHEMAS):
        sql = run("gh", "api", "--hostname", "github.com", "-H", "Accept: application/vnd.github.raw+json",
                  f"repos/AthenZ/athenz/contents/servers/{component}/schema/{component}_server.sql?ref=v{version}")
        targets[schema] = parse_schema(sql, schema)
    statements = plan_schema(targets, installation.metadata(db_pods[0][0]))
    patches, images = deployment_patches(inventory, version, key_ids)
    for image in images:
        emit("info", f"Image: {image}")
    emit("info", "Image preparation: athenz_dist make " + ("build (isolated checkout)" if rebuild else "load-docker-images-internal"))
    emit("info", "Image loading: athenz_dist/kubernetes make kind-load-images-internal")
    emit("info", f"SQL changes: {len(statements)}; existing DB pod and data are retained")
    for statement in statements:
        emit("info", statement)
    if dry_run:
        emit("ok", "Dry run complete; no images pulled, SQL applied or deployments changed")
        return

    # Both image preparation paths use the distribution's existing Makefile.
    # Its DB image may be loaded into kind, but its DB workload is never applied.
    prepare_images(version, rebuild)
    for image in images:
        built_version = run("docker", "image", "inspect", image, "--format",
                            '{{index .Config.Labels "org.opencontainers.image.version"}}').strip()
        if built_version.removeprefix("v") != version:
            raise SwitchError(f"{image}: build version label does not match {version}")
    emit("info", f"Loading images into kind cluster {cluster}")
    run("make", "--no-print-directory", "-C", str(DIST / "kubernetes"), "kind-load-images-internal",
        *distribution_options(version), f"KIND_CLUSTER_NAME={cluster}", f"KIND_CONTEXT={context}")
    if installation.ready_pods("athenz-db") != db_pods:
        raise SwitchError("DB pod changed during preflight; rerun to inspect its current schema")
    if installation.inventory() != inventory:
        raise SwitchError("Deployments changed during preflight; rerun before changing SQL")
    # Replan after downloads, so an interrupted previous run can be retried.
    statements = plan_schema(targets, installation.metadata(db_pods[0][0]))
    if statements:
        emit("info", "Applying compatible SQL changes")
        try:
            installation.sql(db_pods[0][0], "SET SESSION lock_wait_timeout=30;\n" + "\n".join(statements))
        except SwitchError:
            emit("warn", "Some additive SQL changes may have completed; fix the error and rerun. Server images are unchanged.")
            raise
        if plan_schema(targets, installation.metadata(db_pods[0][0])):
            raise SwitchError("SQL verification failed; server images are unchanged")
    try:
        for component, patch in patches.items():
            emit("info", f"Updating {component}")
            installation.kubectl("patch", "deployment", component, "--type=strategic", "-p", json.dumps(patch))
            installation.kubectl("rollout", "status", f"deployment/{component}", "--timeout=180s")
        installation.versions(expected=version)
        if installation.ready_pods("athenz-db") != db_pods:
            raise SwitchError("DB pod changed during the rollout; inspect the local database")
    except SwitchError:
        emit("warn", "Rollout incomplete. Compatible SQL changes remain; fix the error and rerun the same command.")
        for component, (_, containers) in inventory.items():
            for group, name, image in containers:
                if group == "containers" and name == component:
                    emit("warn", f"Previous {component} image: {image}")
        raise
    emit("ok", f"Athenz {version} is running; the existing database was preserved")


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("version", help="release version (1.12.48 or v1.12.48), or latest for the highest stable upstream tag")
    parser.add_argument("--dry-run", action="store_true", help="inspect the live schema and print the plan without applying it")
    parser.add_argument("--rebuild", action="store_true", help="use athenz_dist's build target in a temporary checkout instead of pulling release images")
    args = parser.parse_args(argv)
    version = args.version.removeprefix("v")
    if args.version != "latest" and not RELEASE_VERSION.fullmatch(version):
        emit("err", "Specify a release: make athenz-vup VERSION=1.12.48 (or make athenz-vup for latest); add DRY_RUN=true to preview")
        return 2
    flags = {}
    for name in ("DRY_RUN", "REBUILD"):
        value = os.environ.get(name, "").lower()
        if value not in ("", "false", "0", "true", "1"):
            emit("err", f"{name} must be true or false")
            return 2
        flags[name] = value in ("true", "1")
    try:
        switch(version, args.dry_run or flags["DRY_RUN"], args.rebuild or flags["REBUILD"])
    except (SwitchError, OSError, ValueError) as error:
        emit("err", error)
        return 1
    except KeyboardInterrupt:
        emit("warn", "Interrupted; completed SQL changes and rollouts are retained. Rerun to resume.")
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
