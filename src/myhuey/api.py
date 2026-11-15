"""HTTP routes for the web UI. Each route is a thin call into the library.

The React app is built into static/app (see frontend/). Nothing here returns the bridge
username: setup status reports the bridge address only, and the bridge config is stripped
of its whitelist.
"""

from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field, StrictInt

from .errors import BridgeNotConfigured, HueError, LinkButtonNotPressed, PairingInProgress, RoomNotFound, SceneNotFound
from .hue import COLLECTIONS, PAIRING_WINDOW, HueBridgeClient
from .images import MAX_UPLOAD_BYTES, media_type
from .models import Room
from .palette import MOODS
from .palettes import search as search_palettes
from .placement import resolved_elevation
from .roles import FOCUS_KINDS, find_focus, resolve_roles
from .scenes import Scene
from .service import HueRoomService
from .discovery import discover
from . import setup as setup_flow
from .setup import check_bridge, pair_bridge
from .shapes import BY_ARCHETYPE, BY_MODEL, BY_PRODUCT, DEFAULT_PROFILE

BASE_DIR = Path(__file__).resolve().parents[2]
APP_DIR = BASE_DIR / "static" / "app"
CM = Field(None, ge=-10000, le=10000)
# What the web app expects of this server. Raise it when routes are added, so a page
# served from a newer build tells a person to restart an older running server.
API_REVISION = 4

_NOT_BUILT = """<!doctype html><meta charset="utf-8"><title>MyHuey</title>
<body style="font-family:system-ui;background:#0f0e17;color:#e8e6f0;padding:3rem">
<h1>MyHuey</h1><p>The web app has not been built yet. Run:</p>
<pre>npm --prefix frontend install
npm --prefix frontend run build</pre><p>then reload this page.</p></body>"""


class Body(BaseModel):
    """Request bodies refuse NaN and infinity: JSON from Python can carry them, and one would poison the saved document."""

    model_config = ConfigDict(allow_inf_nan=False)


class PairRequest(Body):
    bridge_ip: str
    app_name: str = "myhuey"


class PairAnyRequest(Body):
    bridge_ips: list[str] = Field(..., min_length=1, max_length=8)
    app_name: str = "myhuey"


class RoomCreate(Body):
    name: str
    width: float = Field(450, ge=1, le=10000, description="cm")
    height: float = Field(300, ge=1, le=10000, description="cm")
    outline: list[list[float]] | None = None
    x: float | None = CM
    y: float | None = CM


class OpeningItem(Body):
    id: str | None = None
    kind: str
    edge: int = Field(..., ge=0)
    offset: float = Field(0, ge=0, le=10000)
    width: float = Field(..., ge=1, le=2000)
    sill: float | None = Field(None, ge=0, le=1000)
    top: float | None = Field(None, ge=0, le=1000)


class PlanUpdate(Body):
    cm_per_px: float | None = Field(None, gt=0, le=100)
    offset: list[float] | None = Field(None, min_length=2, max_length=2)
    rotation: float | None = None
    opacity: float | None = Field(None, ge=0, le=1)


class FurnitureItem(Body):
    id: str | None = None
    kind: str = "custom"
    label: str | None = None
    x: float = 0
    y: float = 0
    width: float = Field(60, ge=1, le=2000)
    depth: float = Field(60, ge=1, le=2000)
    rotation: float = 0
    shape: str = "rect"
    elevation: float | None = Field(None, ge=0, le=1000)
    height: float | None = Field(None, gt=0, le=1000)


class RoomUpdate(Body):
    x: float | None = CM
    y: float | None = CM
    width: float | None = Field(None, ge=30, le=10000)
    height: float | None = Field(None, ge=30, le=10000)
    outline: list[list[float]] | None = None
    units: str | None = None
    furniture: list[FurnitureItem] | None = None
    name: str | None = None
    openings: list[OpeningItem] | None = None
    ceiling: float | None = Field(None, ge=150, le=1000)


class LightPlacement(Body):
    light_id: str
    x: float = 0
    y: float = 0
    label: str | None = None
    rotation: float | None = None
    length: float | None = Field(None, ge=5, le=5000)
    elevation: float | Literal["auto"] | None = None  # cm; "auto" goes back to the product's guess
    role: Literal["auto", "bias", "task", "view"] | None = None


class SuggestRequest(Body):
    mode: str = Field(..., max_length=20)
    at: str | None = Field(None, pattern=r"^([01]\d|2[0-3]):[0-5]\d$", description="HH:MM; default now")
    palette_id: str | None = Field(None, max_length=80)
    count: StrictInt = Field(4, ge=1, le=6)
    seed: StrictInt = Field(0, ge=0, le=1_000_000)


class RoomBrightness(Body):
    brightness: StrictInt = Field(..., ge=1, le=100, description="percent")


class RoomPower(Body):
    on: bool


class PhotoPlacements(BaseModel):
    placements: dict[str, dict[str, float]]


class PhotoTags(BaseModel):
    tags: dict[str, dict[str, float]] = Field(..., max_length=500)


class LightState(BaseModel):
    on: bool | None = None
    brightness: int | None = Field(None, ge=0, le=254)
    color: str | None = None
    xy: list[float] | None = Field(None, min_length=2, max_length=2)
    color_temp: float | None = Field(None, gt=0)


class GradientChange(BaseModel):
    colors: list[str] = Field(..., min_length=1, max_length=10)
    mode: str | None = None


class EffectChange(BaseModel):
    effect: str


def _status_for(exc: Exception) -> int:
    if isinstance(exc, (RoomNotFound, SceneNotFound)):
        return 404
    if isinstance(exc, (LinkButtonNotPressed, PairingInProgress)):
        return 409
    if isinstance(exc, (BridgeNotConfigured, ValueError)):
        return 400
    return 502  # the bridge is unreachable, or it rejected the request


def _require_collection(collection: str) -> None:
    if collection not in COLLECTIONS:
        raise HTTPException(status_code=404, detail=f"Collection '{collection}' is not supported")


async def _read_upload(upload: UploadFile) -> bytes:
    data = await upload.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail=f"Images can be at most {MAX_UPLOAD_BYTES // (1024 * 1024)} MB")
    return data


def room_json(room: Room) -> dict[str, Any]:
    """A room as the app sees it: what is saved, plus each light's worked-out height and its
    role for each kind of focus ("desk", "read", "sofa")."""
    data = room.to_dict()
    roles = {kind: resolve_roles(room, find_focus(room, kind)) for kind in FOCUS_KINDS}
    for light, saved in zip(room.lights, data["lights"]):
        saved["resolved_elevation"] = resolved_elevation(light, room)
        saved["resolved_roles"] = {kind: roles[kind][light.light_id] for kind in FOCUS_KINDS}
    return data


def create_app(storage_path: str | None = None, *, pairing_window: float = PAIRING_WINDOW) -> FastAPI:
    """Build the web app. Config is read from storage on every request, never cached."""
    service = HueRoomService(storage_path)
    app = FastAPI(title="MyHuey")
    app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static"), check_dir=False), name="static")

    @app.exception_handler(HueError)
    @app.exception_handler(ValueError)
    def library_error(_: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(status_code=_status_for(exc), content={"detail": str(exc)})

    @app.get("/", response_class=HTMLResponse)
    def index() -> HTMLResponse:
        page = APP_DIR / "index.html"
        return HTMLResponse(page.read_text(encoding="utf-8") if page.is_file() else _NOT_BUILT)

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        # `api` lets the web page notice a server started before an update.
        return {"status": "ok", "api": API_REVISION}

    # Bridge setup

    @app.get("/api/setup/status")
    def setup_status() -> dict[str, Any]:
        bridge = service.get_bridge()
        return {
            "configured": bool(bridge),
            "bridge": {"ip": bridge["ip"]} if bridge else {},
            "pairing_window": pairing_window,
        }

    @app.get("/api/bridges/discover")
    def discover_bridges() -> list[dict[str, str]]:
        # mDNS on the local network first, then the cloud service (cached 15 minutes).
        return [
            {"id": str(item.get("id", "")), "ip": str(item.get("internalipaddress", "")), "source": str(item.get("source", ""))}
            for item in discover()
        ]

    @app.post("/api/bridge/register-any")
    def register_any_bridge(body: PairAnyRequest) -> dict[str, Any]:
        """Pair whichever of these bridges has its link button pressed first."""
        return setup_flow.pair_any(body.bridge_ips, service=service, app_name=body.app_name, window=pairing_window)

    @app.get("/api/bridges/check")
    def bridge_check(ip: str = Query(..., min_length=1, max_length=255)) -> dict[str, Any]:
        return check_bridge(ip, service=service)

    @app.post("/api/bridge/register")
    def register_bridge(body: PairRequest) -> dict[str, Any]:
        return pair_bridge(body.bridge_ip, service=service, app_name=body.app_name, window=pairing_window)

    # Rooms

    @app.get("/api/rooms")
    def list_rooms() -> list[dict[str, Any]]:
        return [room_json(room) for room in service.rooms()]

    @app.post("/api/rooms")
    def create_room(body: RoomCreate) -> dict[str, Any]:
        return room_json(service.add_room(body.name, body.width, body.height, body.outline, body.x, body.y))

    @app.post("/api/rooms/import")
    def import_rooms() -> dict[str, Any]:
        return {"added": service.import_rooms()}

    @app.get("/api/rooms/{room_name}")
    def get_room(room_name: str) -> dict[str, Any]:
        return room_json(service.get_room(room_name))

    @app.patch("/api/rooms/{room_name}")
    def update_room(room_name: str, body: RoomUpdate) -> dict[str, Any]:
        changes = body.model_dump(exclude_none=True)
        if "furniture" in changes:
            changes["furniture"] = [item.model_dump(exclude_none=True) for item in body.furniture or []]
        if "openings" in changes:
            changes["openings"] = [item.model_dump() for item in body.openings or []]
        if "name" in changes:
            changes["new_name"] = changes.pop("name")
        return room_json(service.update_room(room_name, **changes))

    @app.delete("/api/rooms/{room_name}")
    def delete_room(room_name: str) -> dict[str, str]:
        service.remove_room(room_name)
        return {"status": "deleted"}

    @app.post("/api/rooms/{room_name}/lights")
    def place_light(room_name: str, body: LightPlacement) -> dict[str, Any]:
        light = service.assign_light(
            room_name,
            body.light_id,
            x=body.x,
            y=body.y,
            label=body.label,
            rotation=body.rotation,
            length=body.length,
            elevation=body.elevation,
            role=body.role,
        )
        return light.to_dict()

    @app.post("/api/rooms/{room_name}/power")
    def room_power(room_name: str, body: RoomPower) -> dict[str, Any]:
        results = service.set_room_power(room_name, body.on)
        return {"results": results, "failed": sum(1 for item in results if not item["ok"])}

    @app.post("/api/rooms/{room_name}/brightness")
    def room_brightness(room_name: str, body: RoomBrightness) -> dict[str, Any]:
        results = service.set_room_brightness(room_name, body.brightness)
        return {"results": results, "failed": sum(1 for item in results if not item["ok"])}

    @app.post("/api/rooms/{room_name}/suggest")
    def suggest(room_name: str, body: SuggestRequest) -> list[dict[str, Any]]:
        return service.suggest(room_name, body.mode, at=body.at, palette_id=body.palette_id, count=body.count, seed=body.seed)

    @app.post("/api/rooms/{room_name}/suggest/apply")
    def apply_suggestion(room_name: str, body: dict[str, Any]) -> dict[str, Any]:
        scene = Scene.from_dict({**body, "room": room_name})
        results = service.apply_scene_object(scene)
        return {"scene": scene.name, "results": results}

    @app.get("/api/palettes")
    def palettes(
        tag: str | None = Query(None, max_length=20), q: str | None = Query(None, max_length=60),
        limit: int = Query(60, ge=1, le=500),
    ) -> list[dict[str, Any]]:
        return [palette.to_dict() for palette in search_palettes(tag=tag, q=q, limit=limit)]

    @app.get("/api/preferences")
    def get_preferences() -> dict[str, Any]:
        return service.preferences()

    @app.patch("/api/preferences")
    def update_preferences(body: dict[str, Any]) -> dict[str, Any]:
        return service.update_preferences(body)

    @app.delete("/api/rooms/{room_name}/lights/{light_id}")
    def remove_light(room_name: str, light_id: str) -> dict[str, str]:
        service.remove_light(room_name, light_id)
        return {"status": "removed"}

    # Home plan image

    @app.get("/api/plan")
    def get_plan() -> dict[str, Any] | None:
        return service.get_plan()

    @app.post("/api/plan/image")
    async def upload_plan(file: UploadFile = File(...)) -> dict[str, Any]:
        return service.set_plan_image(await _read_upload(file))

    @app.patch("/api/plan")
    def update_plan(body: PlanUpdate) -> dict[str, Any]:
        return service.update_plan(**body.model_dump(exclude_none=True))

    @app.delete("/api/plan")
    def delete_plan() -> dict[str, str]:
        service.remove_plan()
        return {"status": "removed"}

    # Room photos

    @app.post("/api/rooms/{room_name}/photo")
    async def upload_room_photo(room_name: str, file: UploadFile = File(...)) -> dict[str, Any]:
        service.get_room(room_name)
        return room_json(service.set_room_photo(room_name, await _read_upload(file)))

    @app.delete("/api/rooms/{room_name}/photo")
    def delete_room_photo(room_name: str) -> dict[str, str]:
        service.remove_room_photo(room_name)
        return {"status": "removed"}

    @app.put("/api/rooms/{room_name}/photo/tags")
    def save_photo_tags(room_name: str, body: PhotoTags) -> dict[str, Any]:
        return room_json(service.set_photo_tags(room_name, body.tags))

    @app.put("/api/rooms/{room_name}/photo/placements")
    def save_photo_placements(room_name: str, body: PhotoPlacements) -> dict[str, Any]:
        return room_json(service.set_photo_placements(room_name, body.placements))

    # Images

    @app.post("/api/images")
    async def upload_image(
        file: UploadFile = File(...), count: int = Query(5, ge=1, le=10), mood: str = Query("colorful")
    ) -> dict[str, Any]:
        return service.upload_image(await _read_upload(file), count, mood)

    @app.get("/api/images/{name}")
    def get_image(name: str) -> FileResponse:
        path = service.image_file(name)
        return FileResponse(path, media_type=media_type(name), headers={"Cache-Control": "private, max-age=31536000"})

    @app.get("/api/images/{name}/theme")
    def image_theme(name: str, count: int = Query(5, ge=1, le=10), mood: str = Query("colorful")) -> dict[str, Any]:
        return {"mood": mood, "moods": list(MOODS), "theme": service.palette(name, count, mood)}

    # Scenes

    @app.get("/api/scenes")
    def list_scenes(room: str | None = None) -> list[dict[str, Any]]:
        return [scene.to_dict() for scene in service.scenes(room)]

    @app.post("/api/scenes")
    def create_scene(body: dict[str, Any]) -> dict[str, Any]:
        body = {key: value for key, value in body.items() if key != "id"}
        return service.save_scene(body).to_dict()

    @app.post("/api/scenes/preview")
    def preview_scene(body: dict[str, Any]) -> list[dict[str, Any]]:
        return service.preview_scene(body)

    @app.get("/api/scenes/{scene_id}")
    def get_scene(scene_id: str) -> dict[str, Any]:
        return service.get_scene(scene_id).to_dict()

    @app.put("/api/scenes/{scene_id}")
    def update_scene(scene_id: str, body: dict[str, Any]) -> dict[str, Any]:
        service.get_scene(scene_id)
        return service.save_scene({**body, "id": scene_id}).to_dict()

    @app.delete("/api/scenes/{scene_id}")
    def delete_scene(scene_id: str) -> dict[str, str]:
        service.delete_scene(scene_id)
        return {"status": "deleted"}

    @app.post("/api/scenes/{scene_id}/apply")
    def apply_scene(scene_id: str) -> dict[str, Any]:
        results = service.apply_scene(scene_id)
        return {"results": results, "failed": sum(1 for item in results if item.get("error"))}

    # Lights and other bridge resources

    @app.get("/api/lights")
    def list_lights() -> list[dict[str, Any]]:
        return service.lights()

    @app.get("/api/light-profiles")
    def light_profiles() -> dict[str, Any]:
        """The shape table, so the UI draws lights the same way scenes compute them."""
        return {
            "default": DEFAULT_PROFILE.to_dict(),
            "archetype": {key: value.to_dict() for key, value in BY_ARCHETYPE.items()},
            "product": {key: value.to_dict() for key, value in BY_PRODUCT.items()},
            "model": {key: value.to_dict() for key, value in BY_MODEL.items()},
        }

    @app.put("/api/lights/{light_id}/state")
    def update_light_state(light_id: str, body: LightState) -> dict[str, str]:
        service.set_light(light_id, **body.model_dump(exclude_none=True))
        return {"light_id": light_id, "status": "ok"}

    @app.put("/api/lights/{light_id}/gradient")
    def update_light_gradient(light_id: str, body: GradientChange) -> dict[str, str]:
        service.set_gradient(light_id, body.colors, body.mode)
        return {"light_id": light_id, "status": "ok"}

    @app.put("/api/lights/{light_id}/effect")
    def update_light_effect(light_id: str, body: EffectChange) -> dict[str, str]:
        service.set_effect(light_id, body.effect)
        return {"light_id": light_id, "status": "ok"}

    @app.get("/api/hue/{collection}")
    def hue_collection(collection: str) -> Any:
        _require_collection(collection)
        result = service.client().collection(collection)
        if collection == "config" and isinstance(result, dict):
            result.pop("whitelist", None)  # it lists the usernames of every paired app
        return result

    @app.get("/api/hue/{collection}/{resource_id}")
    def hue_resource(collection: str, resource_id: str) -> Any:
        _require_collection(collection)
        if collection == "config":
            raise HTTPException(status_code=404, detail="The bridge config has no sub-resources here")
        return service.client().resource(collection, resource_id)

    @app.get("/{path:path}", include_in_schema=False)
    def spa_fallback(path: str) -> HTMLResponse:
        if path.startswith(("api/", "static/")):
            raise HTTPException(status_code=404, detail="Not found")
        return index()

    return app


app = create_app()
