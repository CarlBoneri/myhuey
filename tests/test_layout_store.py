import pytest

from myhuey import layout_store
from myhuey.layout_store import backup_layout, delete_layout, list_layouts, load_layout, save_layout, swap_active
from myhuey.storage import load_config, save_config


@pytest.fixture(params=["home.db", "home.json"])
def store(request, tmp_path):
    return tmp_path / request.param


def record(layout_id, created=1, rooms=()):
    return {"id": layout_id, "name": f"Try {layout_id}", "created": created, "updated": created,
            "schema_version": 5, "rooms": list(rooms), "scenes": [], "home": {"plan": None}}


def test_save_load_round_trip(store):
    save_layout(record("a1"), store)
    assert load_layout("a1", store) == record("a1")
    assert load_layout("zz", store) is None


def test_list_is_sorted_by_created(store):
    save_layout(record("late", created=2), store)
    save_layout(record("early", created=1), store)
    assert [item["id"] for item in list_layouts(store)] == ["early", "late"]


def test_list_ignores_main_document_and_backups(store):
    save_config({"bridge": {}, "rooms": [], "scenes": []}, store)
    backup_layout(record("old"), 4, store)
    save_layout(record("a1"), store)
    assert [item["id"] for item in list_layouts(store)] == ["a1"]


def test_delete_removes_only_that_record(store):
    save_layout(record("a1"), store)
    save_layout(record("b2"), store)
    delete_layout("a1", store)
    delete_layout("missing", store)
    assert [item["id"] for item in list_layouts(store)] == ["b2"]


def test_swap_active_moves_both_ways(store):
    save_config({"bridge": {}, "rooms": [{"name": "Office"}], "scenes": [], "schema_version": 5, "layout": {"id": "old", "name": "My home"}}, store)
    save_layout(record("new", rooms=[{"name": "Den"}]), store)
    config = {"bridge": {}, "rooms": [{"name": "Den"}], "scenes": [], "home": {"plan": None}, "schema_version": 5, "layout": {"id": "new", "name": "Try new"}}
    old = record("old", rooms=[{"name": "Office"}])
    swap_active(config, old, "new", store)
    assert load_config(store)["rooms"] == [{"name": "Den"}]
    assert load_config(store)["layout"]["id"] == "new"
    assert load_layout("old", store) == old
    assert load_layout("new", store) is None


def test_swap_active_is_atomic_on_sqlite(tmp_path, monkeypatch):
    store = tmp_path / "home.db"
    original = {"bridge": {}, "rooms": [{"name": "Office"}], "scenes": [], "schema_version": 5, "layout": {"id": "old", "name": "My home"}}
    save_config(original, store)
    sandbox = record("new", rooms=[{"name": "Den"}])
    save_layout(sandbox, store)
    before = load_config(store)

    def boom(*_):
        raise RuntimeError("crash partway")

    monkeypatch.setattr(layout_store, "_delete_in", boom)
    with pytest.raises(RuntimeError):
        swap_active({**before, "rooms": [{"name": "Den"}], "layout": {"id": "new", "name": "Try new"}},
                    record("old", rooms=[{"name": "Office"}]), "new", store)
    assert load_config(store) == before
    assert load_layout("new", store) == sandbox
    assert load_layout("old", store) is None
