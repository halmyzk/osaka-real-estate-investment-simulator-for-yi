"""CI: developer preview is a genuine v1.1 JSON document, not a parallel shape."""
import json
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker

root = Path(__file__).resolve().parents[1]
schema = json.loads((root / "schema" / "v1.1.schema.json").read_text(encoding="utf-8"))
sample = json.loads((root / "preview" / "v11-sample.json").read_text(encoding="utf-8"))
validator = Draft202012Validator(schema, format_checker=FormatChecker())
issues = sorted(validator.iter_errors(sample), key=lambda e: list(map(str, e.absolute_path)))
if issues:
    raise AssertionError("\n".join(f"{'/'.join(map(str, e.absolute_path))}: {e.message}" for e in issues))
assert sample["schemaVersion"] == "1.1.0"
assert len({x["id"] for x in sample["units"]}) == len(sample["units"])
assert len({x["id"] for x in sample["entities"]}) == len(sample["entities"])
print("PASS developer preview JSON validates with v1.1 Draft 2020-12 schema")
