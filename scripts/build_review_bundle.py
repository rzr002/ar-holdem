#!/usr/bin/env python3
"""Build a safe, standalone source review ZIP for AR Hold'em.

The script uses Git's tracked plus non-ignored untracked file list as its input,
then applies path and basename rules before it opens any candidate file. It
never follows symlinks. --dry-run prints the included relative paths without
creating the ZIP or sidecars.
"""

from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path, PurePosixPath
import stat
import subprocess
import sys
import zipfile


ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = ROOT / "ar" / "submission-build"
ARCHIVE_NAME = "ARHoldem-review-source.zip"
MANIFEST_NAME = "ARHoldem-review-source.manifest.txt"
SHA_NAME = "ARHoldem-review-source.sha256"

EXCLUDED_PARTS = {
    ".git", ".venv", ".migration", "__pycache__", ".pytest_cache",
    ".mypy_cache", ".ruff_cache", ".tox", "node_modules", "Workspaces",
    "PluginsUserPreferences", "Support", "Caches", "Cache", "Recordings",
    "recordings", "raw-recordings", "raw_recordings",
}
VIDEO_SUFFIXES = {".mov", ".mp4", ".m4v", ".avi", ".mkv", ".webm", ".mts", ".m2ts"}
LARGE_OR_RAW_SUFFIXES = {".raw", ".log"}
SAFE_ENV_EXAMPLES = {".env.example", "api-config.example.env"}
SENSITIVE_BASENAMES = {
    ".mcp.json", ".netrc", ".npmrc", ".pypirc", "credentials", "credentials.json",
    "credentials.toml", "secrets", "secrets.json", "secrets.yaml", "secrets.yml",
    "secrets.toml", "auth.json", "auth.toml", "config.pem", "mcp.json",
}
SENSITIVE_SUFFIXES = {".pem", ".key", ".p12", ".pfx", ".keystore", ".secret"}
SENSITIVE_STEMS = ("id_rsa", "id_ed25519", "id_ecdsa", "private_key", "private-key")
SENSITIVE_WORDS = ("credential", "secret", "token", "apikey", "api-key", "privatekey", "private-key")
REQUIRED_EXACT = {"README.md", "requirements-lucas.txt"}
REQUIRED_PREFIXES = ("tests/", "ar/lens-studio/ARHoldem/Assets/", "ar/lens-studio/ARHoldem/Packages/",
                     "ar/lens-studio/ARHoldem/devpost/")


def candidate_paths() -> list[str]:
    result = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        cwd=ROOT, check=True, stdout=subprocess.PIPE,
    ).stdout
    return sorted({entry.decode("utf-8", "surrogateescape") for entry in result.split(b"\0") if entry})


def exclusion_reason(raw_path: str) -> str | None:
    path = PurePosixPath(raw_path)
    parts = path.parts
    name = path.name
    lower = name.casefold()
    # Editor-local config can contain credentials even when it is not named
    # "secret". Keep the source archive portable and limited to project files.
    if any(part.casefold() in {".claude", ".codex", ".cursor", ".vscode"} for part in parts):
        return "local editor configuration"
    if any(part in EXCLUDED_PARTS or part.casefold() in {p.casefold() for p in EXCLUDED_PARTS}
           for part in parts):
        return "excluded directory"
    if lower in SENSITIVE_BASENAMES:
        return "sensitive basename"
    if lower in SAFE_ENV_EXAMPLES:
        return None
    if lower == ".env" or lower.startswith(".env.") or lower.endswith(".local.env"):
        return "environment file"
    if path.suffix.casefold() in SENSITIVE_SUFFIXES:
        return "sensitive file extension"
    if path.suffix.casefold() in VIDEO_SUFFIXES:
        return "video recording/media"
    if path.suffix.casefold() in LARGE_OR_RAW_SUFFIXES:
        return "raw data or log"
    if lower.startswith(SENSITIVE_STEMS):
        return "private key basename"
    if any(word in lower for word in SENSITIVE_WORDS):
        return "sensitive basename"
    return None


def collect() -> tuple[list[tuple[str, Path]], list[tuple[str, str]]]:
    included: list[tuple[str, Path]] = []
    excluded: list[tuple[str, str]] = []
    root = ROOT.resolve()
    for relative in candidate_paths():
        reason = exclusion_reason(relative)
        source = ROOT / relative
        if reason:
            excluded.append((relative, reason))
            continue
        # Do not traverse links, including links that resolve back into the repo.
        if source.is_symlink():
            excluded.append((relative, "symlink not packaged"))
            continue
        try:
            resolved = source.resolve(strict=True)
            resolved.relative_to(root)
        except (OSError, ValueError):
            excluded.append((relative, "missing or outside project root"))
            continue
        if not source.is_file():
            excluded.append((relative, "not a regular file"))
            continue
        included.append((relative, source))
    return included, excluded


def check_required(paths: set[str]) -> None:
    missing = sorted(REQUIRED_EXACT - paths)
    for prefix in REQUIRED_PREFIXES:
        if not any(path.startswith(prefix) for path in paths):
            missing.append(prefix + "*")
    if not any("license" in PurePosixPath(path).name.casefold() for path in paths):
        missing.append("a LICENSE file")
    if missing:
        raise SystemExit("Refusing incomplete bundle; missing required source groups: " + ", ".join(missing))


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def build(included: list[tuple[str, Path]]) -> tuple[Path, Path, Path]:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    archive = OUTPUT_DIR / ARCHIVE_NAME
    manifest = OUTPUT_DIR / MANIFEST_NAME
    checksum = OUTPUT_DIR / SHA_NAME
    temporary = archive.with_suffix(archive.suffix + ".tmp")
    try:
        with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
            for relative, source in included:
                info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = (stat.S_IFREG | (source.stat().st_mode & 0o755)) << 16
                bundle.writestr(info, source.read_bytes())
        os.replace(temporary, archive)
    finally:
        temporary.unlink(missing_ok=True)

    manifest.write_text("\n".join(relative for relative, _ in included) + "\n", encoding="utf-8")
    checksum.write_text(f"{sha256(archive)}  {ARCHIVE_NAME}\n", encoding="ascii")
    return archive, manifest, checksum


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="list included paths; write no files")
    args = parser.parse_args()
    included, excluded = collect()
    paths = {relative for relative, _ in included}
    check_required(paths)
    if args.dry_run:
        for relative, _source in included:
            print(relative)
        print(f"\nIncluded: {len(included)}; excluded by policy: {len(excluded)}")
        return 0
    archive, manifest, checksum = build(included)
    print(f"Created {archive.relative_to(ROOT)}")
    print(f"Manifest: {manifest.relative_to(ROOT)}")
    print(f"SHA256: {checksum.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
