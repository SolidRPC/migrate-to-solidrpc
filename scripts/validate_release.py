#!/usr/bin/env python3
from __future__ import annotations

import ast
import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parents[1]
PLUGIN_NAME = "migrate-to-solidrpc"
RELEASE_VERSION = "0.1.3"
REPOSITORY_URL = "https://github.com/SolidRPC/migrate-to-solidrpc"
WEBSITE_URL = "https://solidrpc.io"
PLUGIN_DESCRIPTION = (
    "Replace compatible EVM RPC traffic with one SolidRPC integration through a guided, "
    "tested repository change."
)
PLUGIN_SHORT_DESCRIPTION = "Replace EVM RPC with one SolidRPC integration"
PLUGIN_LONG_DESCRIPTION = (
    "Inspect the repository, replace compatible HTTPS JSON-RPC traffic with one SolidRPC "
    "integration, run the project's checks, and present the direct diff and Git rollback "
    "steps. Incompatible WebSocket, subscription, webhook, browser-credential, and "
    "provider-specific paths remain explicit."
)
PLUGIN_DEFAULT_PROMPT = [
    "Migrate compatible HTTPS JSON-RPC to SolidRPC. Make the local change, run checks, and "
    "show the diff and Git rollback steps."
]
BRAND_COLOR = "#7C3AED"
ICON_PATH = "./assets/solidrpc-mark-dark.png"
CODEX_MANIFEST = ROOT / ".codex-plugin" / "plugin.json"
CLAUDE_MANIFEST = ROOT / ".claude-plugin" / "plugin.json"
CODEX_MARKETPLACE = ROOT / ".agents" / "plugins" / "marketplace.json"
CLAUDE_MARKETPLACE = ROOT / ".claude-plugin" / "marketplace.json"
SKILL_ROOT = ROOT / "skills" / PLUGIN_NAME
NODE_PROJECTS = (ROOT / "examples" / "viem-app", ROOT / "tests" / "fixtures" / "viem-app-before")

SEMVER = re.compile(
    r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
    r"(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"
    r"(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)
MARKDOWN_LINK = re.compile(r"\[[^\]]*\]\(([^)]+)\)")
SECRET_PATTERNS = {
    "SolidRPC API key": re.compile(r"\bak_[0-9a-fA-F]{64}\b"),
    "GitHub token": re.compile(r"\bgh[pousr]_[A-Za-z0-9]{36,255}\b"),
    "AWS access key": re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    "private key PEM": re.compile(r"-----BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----"),
    "assigned EVM private key": re.compile(
        r"(?im)\b(?:PRIVATE_KEY|WALLET_KEY)\b\s*[:=]\s*['\"]?(?:0x)?[0-9a-f]{64}\b"
    ),
}


class Validation:
    def __init__(self) -> None:
        self.errors: list[str] = []

    def check(self, condition: bool, message: str) -> None:
        if not condition:
            self.errors.append(message)

    def finish(self) -> None:
        if self.errors:
            print("Release validation failed:")
            for error in self.errors:
                print(f"- {error}")
            raise SystemExit(1)
        print(f"Release validation passed: {PLUGIN_NAME} v{RELEASE_VERSION}")


def load_json(path: Path, validation: Validation) -> dict[str, Any]:
    if not path.is_file():
        validation.errors.append(f"missing {path.relative_to(ROOT)}")
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        validation.errors.append(f"invalid JSON in {path.relative_to(ROOT)}: {error}")
        return {}
    if not isinstance(value, dict):
        validation.errors.append(f"{path.relative_to(ROOT)} must contain a JSON object")
        return {}
    return value


def strip_yaml_comment(value: str) -> str:
    quote: str | None = None
    escaped = False
    for index, character in enumerate(value):
        if escaped:
            escaped = False
            continue
        if character == "\\" and quote == '"':
            escaped = True
            continue
        if character in {"'", '"'}:
            if quote is None:
                quote = character
            elif quote == character:
                quote = None
            continue
        if character == "#" and quote is None and (index == 0 or value[index - 1].isspace()):
            return value[:index].rstrip()
    return value.rstrip()


def parse_yaml_scalar(raw: str, source: str, line_number: int) -> Any:
    value = strip_yaml_comment(raw).strip()
    if not value:
        raise ValueError(f"{source}:{line_number}: missing YAML value")
    if value[0] in {'"', "'"}:
        try:
            parsed = ast.literal_eval(value)
        except (SyntaxError, ValueError) as error:
            raise ValueError(f"{source}:{line_number}: invalid quoted YAML scalar") from error
        if not isinstance(parsed, str):
            raise ValueError(f"{source}:{line_number}: expected a string scalar")
        return parsed
    lowered = value.lower()
    if lowered in {"true", "false"}:
        return lowered == "true"
    if lowered in {"null", "~"}:
        return None
    if re.fullmatch(r"-?(?:0|[1-9]\d*)", value):
        return int(value)
    if value.startswith("[") or value.startswith("{"):
        try:
            return json.loads(value)
        except json.JSONDecodeError as error:
            raise ValueError(
                f"{source}:{line_number}: inline YAML collections must use JSON syntax"
            ) from error
    if value[0] in {"|", ">", "-", "?", "&", "*", "!"}:
        raise ValueError(f"{source}:{line_number}: unsupported YAML construct")
    return value


def parse_yaml_mapping(text: str, source: str) -> dict[str, Any]:
    root: dict[str, Any] = {}
    stack: list[tuple[int, dict[str, Any]]] = [(-1, root)]
    for line_number, original in enumerate(text.splitlines(), start=1):
        if not original.strip() or original.lstrip().startswith("#"):
            continue
        if "\t" in original[: len(original) - len(original.lstrip())]:
            raise ValueError(f"{source}:{line_number}: tabs are not valid indentation")
        indent = len(original) - len(original.lstrip(" "))
        if indent % 2:
            raise ValueError(f"{source}:{line_number}: use two-space YAML indentation")
        content = strip_yaml_comment(original[indent:])
        if not content:
            continue
        if ":" not in content:
            raise ValueError(f"{source}:{line_number}: expected a YAML mapping entry")
        key, raw_value = content.split(":", 1)
        key = key.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]*", key):
            raise ValueError(f"{source}:{line_number}: invalid or unsupported YAML key")
        while stack and stack[-1][0] >= indent:
            stack.pop()
        if not stack:
            raise ValueError(f"{source}:{line_number}: invalid YAML indentation")
        parent = stack[-1][1]
        if key in parent:
            raise ValueError(f"{source}:{line_number}: duplicate YAML key {key!r}")
        if raw_value.strip():
            parent[key] = parse_yaml_scalar(raw_value, source, line_number)
        else:
            child: dict[str, Any] = {}
            parent[key] = child
            stack.append((indent, child))
    return root


def load_yaml_mapping(text: str, source: str, validation: Validation) -> dict[str, Any]:
    try:
        return parse_yaml_mapping(text, source)
    except ValueError as error:
        validation.errors.append(str(error))
        return {}


def load_skill(validation: Validation) -> tuple[dict[str, Any], str]:
    path = SKILL_ROOT / "SKILL.md"
    if not path.is_file():
        validation.errors.append(f"missing {path.relative_to(ROOT)}")
        return {}, ""
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines()
    if not lines or lines[0] != "---":
        validation.errors.append("SKILL.md must start with YAML frontmatter")
        return {}, text
    try:
        end = lines.index("---", 1)
    except ValueError:
        validation.errors.append("SKILL.md YAML frontmatter is not closed")
        return {}, text
    frontmatter = load_yaml_mapping("\n".join(lines[1:end]), "SKILL.md frontmatter", validation)
    validation.check(bool("\n".join(lines[end + 1 :]).strip()), "SKILL.md instruction body is empty")
    return frontmatter, text


def is_non_empty_string(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def normalized_repository(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    return value.removesuffix(".git").rstrip("/")


def require_manifest_basics(
    manifest: dict[str, Any], label: str, validation: Validation
) -> None:
    validation.check(manifest.get("name") == PLUGIN_NAME, f"{label} name must be {PLUGIN_NAME}")
    version = manifest.get("version")
    validation.check(version == RELEASE_VERSION, f"{label} version must be {RELEASE_VERSION}")
    validation.check(
        isinstance(version, str) and SEMVER.fullmatch(version) is not None,
        f"{label} version must use strict semantic versioning",
    )
    validation.check(is_non_empty_string(manifest.get("description")), f"{label} needs a description")
    validation.check(
        manifest.get("description") == PLUGIN_DESCRIPTION,
        f"{label} description must match the public migration description",
    )
    author = manifest.get("author")
    validation.check(
        isinstance(author, dict) and is_non_empty_string(author.get("name")),
        f"{label} needs author.name",
    )
    validation.check(manifest.get("license") == "MIT", f"{label} license must be MIT")
    validation.check(
        normalized_repository(manifest.get("repository")) == REPOSITORY_URL,
        f"{label} repository must be {REPOSITORY_URL}",
    )
    validation.check(manifest.get("homepage") == WEBSITE_URL, f"{label} homepage must be {WEBSITE_URL}")


def reject_unknown_fields(
    payload: dict[str, Any], allowed: set[str], label: str, validation: Validation
) -> None:
    for key in sorted(set(payload) - allowed):
        validation.errors.append(f"{label} contains unsupported field {key!r}")


def validate_codex_manifest(manifest: dict[str, Any], validation: Validation) -> None:
    reject_unknown_fields(
        manifest,
        {
            "id",
            "name",
            "version",
            "description",
            "skills",
            "apps",
            "mcpServers",
            "interface",
            "author",
            "homepage",
            "repository",
            "license",
            "keywords",
        },
        "Codex plugin manifest",
        validation,
    )
    require_manifest_basics(manifest, "Codex plugin manifest", validation)
    validation.check(manifest.get("skills") == "./skills/", "Codex manifest skills must be ./skills/")
    interface = manifest.get("interface")
    validation.check(isinstance(interface, dict), "Codex manifest interface must be an object")
    if isinstance(interface, dict):
        for field in (
            "displayName",
            "shortDescription",
            "longDescription",
            "developerName",
            "category",
        ):
            validation.check(
                is_non_empty_string(interface.get(field)),
                f"Codex manifest interface.{field} must be a non-empty string",
            )
        validation.check(
            isinstance(interface.get("capabilities"), list)
            and all(is_non_empty_string(item) for item in interface["capabilities"]),
            "Codex manifest interface.capabilities must be an array of non-empty strings",
        )
        validation.check(
            interface.get("shortDescription") == PLUGIN_SHORT_DESCRIPTION,
            "Codex manifest interface.shortDescription must match the public card copy",
        )
        validation.check(
            interface.get("longDescription") == PLUGIN_LONG_DESCRIPTION,
            "Codex manifest interface.longDescription must match the public detail copy",
        )
        validation.check(
            interface.get("websiteURL") == WEBSITE_URL,
            f"Codex manifest interface.websiteURL must be {WEBSITE_URL}",
        )
        validation.check(
            interface.get("brandColor") == BRAND_COLOR,
            f"Codex manifest interface.brandColor must be {BRAND_COLOR}",
        )
        for icon_field in ("composerIcon", "logo", "logoDark"):
            validation.check(
                interface.get(icon_field) == ICON_PATH,
                f"Codex manifest interface.{icon_field} must be {ICON_PATH}",
            )
        prompt = interface.get("defaultPrompt", interface.get("default_prompt"))
        prompt_valid = is_non_empty_string(prompt) or (
            isinstance(prompt, list)
            and 0 < len(prompt) <= 3
            and all(is_non_empty_string(item) and len(item) <= 128 for item in prompt)
        )
        validation.check(prompt_valid, "Codex manifest needs a valid default prompt")
        validation.check(
            prompt == PLUGIN_DEFAULT_PROMPT,
            "Codex manifest default prompt must describe one guided migration, checks, diff, "
            "and Git rollback",
        )
    validate_manifest_paths(manifest, CODEX_MANIFEST, validation)


def validate_claude_manifest(manifest: dict[str, Any], validation: Validation) -> None:
    reject_unknown_fields(
        manifest,
        {
            "$schema",
            "name",
            "version",
            "description",
            "author",
            "homepage",
            "repository",
            "license",
            "keywords",
            "skills",
        },
        "Claude plugin manifest",
        validation,
    )
    require_manifest_basics(manifest, "Claude plugin manifest", validation)
    if "skills" in manifest:
        validation.check(
            manifest["skills"] == "./skills/", "Claude manifest skills, when present, must be ./skills/"
        )
    validate_manifest_paths(manifest, CLAUDE_MANIFEST, validation)


def validate_manifest_paths(
    manifest: dict[str, Any], manifest_path: Path, validation: Validation
) -> None:
    path_fields = {"skills", "apps", "hooks", "composerIcon", "logo", "logoDark"}

    def visit(value: Any, key: str | None = None) -> None:
        if isinstance(value, dict):
            for child_key, child in value.items():
                visit(child, child_key)
        elif isinstance(value, list):
            for child in value:
                visit(child, key)
        elif key in path_fields and isinstance(value, str):
            validation.check(value.startswith("./"), f"{manifest_path.name} path {value!r} must start with ./")
            resolved = (ROOT / value).resolve()
            validation.check(
                resolved == ROOT or ROOT in resolved.parents,
                f"{manifest_path.name} path {value!r} escapes the plugin root",
            )
            validation.check(resolved.exists(), f"{manifest_path.name} references missing path {value}")

    visit(manifest)


def find_plugin_entry(
    marketplace: dict[str, Any], label: str, validation: Validation
) -> dict[str, Any]:
    plugins = marketplace.get("plugins")
    if not isinstance(plugins, list):
        validation.errors.append(f"{label} plugins must be an array")
        return {}
    matches = [entry for entry in plugins if isinstance(entry, dict) and entry.get("name") == PLUGIN_NAME]
    validation.check(len(matches) == 1, f"{label} must contain exactly one {PLUGIN_NAME} entry")
    return matches[0] if len(matches) == 1 else {}


def validate_codex_marketplace(marketplace: dict[str, Any], validation: Validation) -> None:
    validation.check(is_non_empty_string(marketplace.get("name")), "Codex marketplace needs a name")
    entry = find_plugin_entry(marketplace, "Codex marketplace", validation)
    source = entry.get("source")
    expected_source = {"source": "local", "path": "./"}
    validation.check(source == expected_source, f"Codex marketplace source must be {expected_source}")
    policy = entry.get("policy")
    validation.check(
        isinstance(policy, dict)
        and policy.get("installation") == "AVAILABLE"
        and policy.get("authentication") == "ON_INSTALL",
        "Codex marketplace policy must use AVAILABLE and ON_INSTALL",
    )
    validation.check(is_non_empty_string(entry.get("category")), "Codex marketplace needs a category")


def validate_claude_marketplace(marketplace: dict[str, Any], validation: Validation) -> None:
    validation.check(is_non_empty_string(marketplace.get("name")), "Claude marketplace needs a name")
    entry = find_plugin_entry(marketplace, "Claude marketplace", validation)
    validation.check(entry.get("source") == "./", "Claude marketplace source must be ./")
    if "version" in entry:
        validation.check(
            entry["version"] == RELEASE_VERSION,
            f"Claude marketplace version must be {RELEASE_VERSION}",
        )
    if "license" in entry:
        validation.check(entry["license"] == "MIT", "Claude marketplace license must be MIT")
    if "repository" in entry:
        validation.check(
            normalized_repository(entry["repository"]) == REPOSITORY_URL,
            f"Claude marketplace repository must be {REPOSITORY_URL}",
        )
    metadata = marketplace.get("metadata")
    if isinstance(metadata, dict) and "version" in metadata:
        validation.check(
            metadata["version"] == RELEASE_VERSION,
            f"Claude marketplace metadata.version must be {RELEASE_VERSION}",
        )
    source_root = (ROOT / entry.get("source", "missing")).resolve()
    validation.check(source_root == ROOT, "Claude marketplace source must resolve to the repository root")
    validation.check(
        (source_root / ".claude-plugin" / "plugin.json").is_file(),
        "Claude marketplace source does not contain its plugin manifest",
    )


def validate_skill(validation: Validation) -> None:
    frontmatter, _ = load_skill(validation)
    validation.check(
        set(frontmatter) == {"name", "description", "license"},
        "SKILL.md frontmatter needs name, description, and license",
    )
    validation.check(frontmatter.get("name") == PLUGIN_NAME, "SKILL.md name must match its directory")
    name = frontmatter.get("name")
    validation.check(
        isinstance(name, str)
        and len(name) <= 64
        and re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", name) is not None,
        "SKILL.md name must be at most 64 characters of lowercase hyphen-case",
    )
    description = frontmatter.get("description")
    validation.check(
        is_non_empty_string(description)
        and len(description) <= 1024
        and "<" not in description
        and ">" not in description,
        "SKILL.md description must be a non-empty string of at most 1024 characters",
    )
    validation.check(frontmatter.get("license") == "MIT", "SKILL.md license must be MIT")
    agent_path = SKILL_ROOT / "agents" / "openai.yaml"
    if not agent_path.is_file():
        validation.errors.append("missing skills/migrate-to-solidrpc/agents/openai.yaml")
        return
    agent = load_yaml_mapping(
        agent_path.read_text(encoding="utf-8"),
        str(agent_path.relative_to(ROOT)),
        validation,
    )
    interface = agent.get("interface")
    validation.check(isinstance(interface, dict), "agents/openai.yaml needs an interface mapping")
    if isinstance(interface, dict):
        for field in ("display_name", "short_description", "default_prompt"):
            validation.check(
                is_non_empty_string(interface.get(field)),
                f"agents/openai.yaml interface.{field} must be a non-empty string",
            )
        validation.check(
            f"${PLUGIN_NAME}" in str(interface.get("default_prompt", "")),
            "agents/openai.yaml default_prompt must explicitly invoke the skill",
        )
    policy = agent.get("policy")
    validation.check(
        isinstance(policy, dict) and policy.get("allow_implicit_invocation") is True,
        "agents/openai.yaml must enable implicit invocation",
    )


def release_files(validation: Validation) -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=ROOT,
        check=False,
        capture_output=True,
    )
    if result.returncode != 0:
        validation.errors.append("git ls-files failed while enumerating release files")
        return []
    return [ROOT / item.decode() for item in result.stdout.split(b"\0") if item]


def read_text(path: Path) -> str | None:
    try:
        data = path.read_bytes()
    except OSError:
        return None
    if b"\0" in data:
        return None
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return None


def validate_release_files(validation: Validation) -> None:
    files = release_files(validation)
    marker_names = ("TO" + "DO", "FIX" + "ME", "T" + "BD")
    forbidden_markers = re.compile(r"\b(?:" + "|".join(marker_names) + r")\b", re.IGNORECASE)
    allowed_env_names = {".env.example", ".env.sample", ".env.template"}
    for path in files:
        relative = path.relative_to(ROOT)
        validation.check(path.is_file(), f"tracked path is missing: {relative}")
        if path.name.startswith(".env") and path.name not in allowed_env_names:
            validation.errors.append(f"real environment file is tracked: {relative}")
        text = read_text(path)
        if text is None:
            continue
        if forbidden_markers.search(text):
            validation.errors.append(f"unfinished marker found in {relative}")
        for label, pattern in SECRET_PATTERNS.items():
            if pattern.search(text):
                validation.errors.append(f"possible {label} found in {relative}")
        for line_number, line in enumerate(text.splitlines(), start=1):
            if line.endswith((" ", "\t")):
                validation.errors.append(f"trailing whitespace in {relative}:{line_number}")
        if text and not text.endswith("\n"):
            validation.errors.append(f"missing final newline in {relative}")


def validate_reachable_history(validation: Validation) -> None:
    result = subprocess.run(
        ["git", "log", "--all", "--format=", "--patch", "--no-ext-diff", "--binary"],
        cwd=ROOT,
        check=False,
        capture_output=True,
    )
    if result.returncode != 0:
        validation.errors.append("git log failed while scanning reachable history")
        return
    history = result.stdout.decode("utf-8", errors="ignore")
    for label, pattern in SECRET_PATTERNS.items():
        if pattern.search(history):
            validation.errors.append(f"possible {label} found in reachable Git history")


def validate_public_version_references(validation: Validation) -> None:
    current_tag = f"v{RELEASE_VERSION}"
    changelog = read_text(ROOT / "CHANGELOG.md")
    if changelog is None:
        validation.errors.append("cannot read CHANGELOG.md for version validation")
        return
    headings = re.findall(r"^## \[([^]]+)\]", changelog, flags=re.MULTILINE)
    validation.check(
        bool(headings) and headings[0] == RELEASE_VERSION,
        f"CHANGELOG.md latest heading must be {RELEASE_VERSION}",
    )
    validation.check(
        len(headings) == len(set(headings))
        and all(SEMVER.fullmatch(version) is not None for version in headings),
        "CHANGELOG.md release headings must be unique semantic versions",
    )
    validation.check(
        f"[{RELEASE_VERSION}]: {REPOSITORY_URL}/releases/tag/{current_tag}" in changelog,
        f"CHANGELOG.md must link release {current_tag}",
    )

    known_release_versions = set(headings)
    version_token = re.compile(
        r"(?<![A-Za-z0-9.])(?P<prefix>v)?(?P<version>\d+\.\d+\.\d+)"
        r"(?![A-Za-z0-9.])"
    )
    for relative in (Path("README.md"), Path("tests/FORWARD_EVALUATION.md")):
        text = read_text(ROOT / relative)
        if text is None:
            validation.errors.append(f"cannot read {relative} for version validation")
            continue
        versions = {
            match.group("version")
            for match in version_token.finditer(text)
            if match.group("prefix") is not None
            or match.group("version") in known_release_versions
        }
        validation.check(
            versions == {RELEASE_VERSION},
            f"{relative} public release version references must all be {current_tag} or "
            f"{RELEASE_VERSION}; found {sorted(versions) or ['none']}",
        )


def validate_markdown_links(validation: Validation) -> None:
    for path in release_files(validation):
        if path.suffix.lower() != ".md":
            continue
        text = read_text(path)
        if text is None:
            continue
        for match in MARKDOWN_LINK.finditer(text):
            raw_target = match.group(1).strip()
            if raw_target.startswith("<") and raw_target.endswith(">"):
                raw_target = raw_target[1:-1]
            target = raw_target.split(maxsplit=1)[0].split("#", 1)[0]
            if not target:
                continue
            parsed = urlparse(target)
            if parsed.scheme or target.startswith("//"):
                continue
            resolved = (path.parent / unquote(target)).resolve()
            validation.check(
                resolved == ROOT or ROOT in resolved.parents,
                f"Markdown link escapes repository in {path.relative_to(ROOT)}: {target}",
            )
            validation.check(
                resolved.exists(),
                f"broken Markdown link in {path.relative_to(ROOT)}: {target}",
            )


def validate_license_and_security(validation: Validation) -> None:
    license_path = ROOT / "LICENSE"
    security_path = ROOT / "SECURITY.md"
    validation.check(license_path.is_file(), "missing LICENSE")
    if license_path.is_file():
        license_text = license_path.read_text(encoding="utf-8")
        validation.check("MIT License" in license_text, "LICENSE must contain the MIT License")
        validation.check("SolidRPC" in license_text, "LICENSE must identify SolidRPC")
    validation.check(security_path.is_file(), "missing SECURITY.md")
    if security_path.is_file():
        security_text = security_path.read_text(encoding="utf-8")
        validation.check(len(security_text.strip()) >= 200, "SECURITY.md is incomplete")


def engine_allows_major(specification: str, major: int) -> bool:
    if "||" in specification or "-" in specification:
        return False
    constraints = re.findall(r"(>=|<=|>|<|=|\^|~)?\s*(\d+)(?:\.\d+){0,2}", specification)
    if not constraints:
        return False
    for operator, raw_version in constraints:
        version = int(raw_version)
        if operator == ">=" and major < version:
            return False
        if operator == ">" and major <= version:
            return False
        if operator == "<=" and major > version:
            return False
        if operator == "<" and major >= version:
            return False
        if operator in {"", "=", "^", "~"} and major != version:
            return False
    return True


def validate_node_engines(validation: Validation) -> None:
    raw_major = os.environ.get("RELEASE_NODE_MAJOR", "22")
    validation.check(raw_major.isdigit(), "RELEASE_NODE_MAJOR must be an integer")
    if not raw_major.isdigit():
        return
    major = int(raw_major)
    for project in NODE_PROJECTS:
        package = load_json(project / "package.json", validation)
        engines = package.get("engines")
        node = engines.get("node") if isinstance(engines, dict) else None
        validation.check(
            isinstance(node, str) and engine_allows_major(node, major),
            f"Node {major} does not satisfy {project.relative_to(ROOT)}/package.json engines.node",
        )


def validate_release_ref(validation: Validation) -> None:
    if os.environ.get("GITHUB_REF_TYPE") != "tag":
        return
    ref_name = os.environ.get("GITHUB_REF_NAME")
    validation.check(
        ref_name == f"v{RELEASE_VERSION}",
        f"release tag must be v{RELEASE_VERSION}, received {ref_name or '<missing>'}",
    )


def validate_worktree_whitespace(validation: Validation) -> None:
    result = subprocess.run(
        ["git", "diff", "--check"],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )
    validation.check(result.returncode == 0, f"git diff --check failed:\n{result.stdout}{result.stderr}")


def main() -> None:
    validation = Validation()
    codex_manifest = load_json(CODEX_MANIFEST, validation)
    claude_manifest = load_json(CLAUDE_MANIFEST, validation)
    codex_marketplace = load_json(CODEX_MARKETPLACE, validation)
    claude_marketplace = load_json(CLAUDE_MARKETPLACE, validation)
    if codex_manifest:
        validate_codex_manifest(codex_manifest, validation)
    if claude_manifest:
        validate_claude_manifest(claude_manifest, validation)
    if codex_marketplace:
        validate_codex_marketplace(codex_marketplace, validation)
    if claude_marketplace:
        validate_claude_marketplace(claude_marketplace, validation)
    if codex_manifest and claude_manifest:
        validation.check(
            codex_manifest.get("name") == claude_manifest.get("name"),
            "Codex and Claude plugin names differ",
        )
        validation.check(
            codex_manifest.get("version") == claude_manifest.get("version"),
            "Codex and Claude plugin versions differ",
        )
        validation.check(
            codex_manifest.get("description") == claude_manifest.get("description"),
            "Codex and Claude plugin descriptions differ",
        )
        validation.check(
            codex_manifest.get("keywords") == claude_manifest.get("keywords"),
            "Codex and Claude plugin keywords differ",
        )
    validate_skill(validation)
    validate_license_and_security(validation)
    validate_node_engines(validation)
    validate_release_ref(validation)
    validate_release_files(validation)
    validate_reachable_history(validation)
    validate_public_version_references(validation)
    validate_markdown_links(validation)
    validate_worktree_whitespace(validation)
    validation.finish()


if __name__ == "__main__":
    main()
