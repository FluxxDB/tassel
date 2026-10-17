import json

from tassel.scripts.export_openapi import DEFAULT_OUTPUT, main


def test_writes_the_schema_as_sorted_json_with_lf_endings(tmp_path):
    output = tmp_path / "api" / "openapi.json"
    main([str(output)])
    raw = output.read_bytes()
    assert b"\r" not in raw and raw.endswith(b"}\n")
    schema = json.loads(raw)
    assert raw.decode() == json.dumps(schema, sort_keys=True, indent=2) + "\n"
    assert "/v1/sessions/{session_id}" in schema["paths"]


def test_writes_to_the_shared_package_by_default():
    assert DEFAULT_OUTPUT.parts[-4:] == ("shared", "src", "api", "openapi.json")
    assert (DEFAULT_OUTPUT.parents[2] / "package.json").is_file()
