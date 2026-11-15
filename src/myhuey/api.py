"""HTTP routes for the web UI. Each route is a thin call into the library."""

from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .errors import BridgeNotConfigured, HueError, LinkButtonNotPressed, RoomNotFound
from .hue import COLLECTIONS, PAIRING_WINDOW, HueBridgeClient
from .service import HueRoomService
from .setup import pair_bridge

BASE_DIR = Path(__file__).resolve().parents[2]


class PairRequest(BaseModel):
    bridge_ip: str
    app_name: str = "myhuey"


class RoomCreate(BaseModel):
    name: str
    width: int = Field(900, ge=100, le=10000)
    height: int = Field(600, ge=100, le=10000)


class RoomUpdate(BaseModel):
    x: float | None = None
    y: float | None = None
    width: int | None = Field(None, ge=100, le=10000)
    height: int | None = Field(None, ge=100, le=10000)


class LightPlacement(BaseModel):
    light_id: str
    x: float = 0
    y: float = 0
    label: str | None = None


class LightState(BaseModel):
    on: bool | None = None
    brightness: int | None = Field(None, ge=0, le=254)
    color: str | None = None
    xy: list[float] | None = Field(None, min_length=2, max_length=2)
    color_temp: float | None = Field(None, gt=0)


def _status_for(exc: Exception) -> int:
    if isinstance(exc, RoomNotFound):
        return 404
    if isinstance(exc, LinkButtonNotPressed):
        return 409
    if isinstance(exc, (BridgeNotConfigured, ValueError)):
        return 400
    return 502  # the bridge is unreachable, or it rejected the request


def _require_collection(collection: str) -> None:
    if collection not in COLLECTIONS:
        raise HTTPException(status_code=404, detail=f"Collection '{collection}' is not supported")


def create_app(storage_path: str | None = None, *, pairing_window: float = PAIRING_WINDOW) -> FastAPI:
    """Build the web app. Config is read from storage on every request, never cached."""
    service = HueRoomService(storage_path)
    app = FastAPI(title="MyHuey")
    app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

    @app.exception_handler(HueError)
    @app.exception_handler(ValueError)
    def library_error(_: Request, exc: Exception) -> JSONResponse:
        return JSONResponse(status_code=_status_for(exc), content={"detail": str(exc)})

    @app.get("/", response_class=HTMLResponse)
    def index() -> HTMLResponse:
        return HTMLResponse((BASE_DIR / "templates" / "index.html").read_text(encoding="utf-8"))

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

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
        return [
            {"id": str(item.get("id", "")), "ip": str(item.get("internalipaddress", ""))}
            for item in HueBridgeClient.discover_bridges()
        ]

    @app.post("/api/bridge/register")
    def register_bridge(body: PairRequest) -> dict[str, Any]:
        return pair_bridge(body.bridge_ip, service=service, app_name=body.app_name, window=pairing_window)

    # Rooms

    @app.get("/api/rooms")
    def list_rooms() -> list[dict[str, Any]]:
        return [room.to_dict() for room in service.rooms()]

    @app.post("/api/rooms")
    def create_room(body: RoomCreate) -> dict[str, Any]:
        return service.add_room(body.name, body.width, body.height).to_dict()

    @app.post("/api/rooms/import")
    def import_rooms() -> dict[str, Any]:
        return {"added": service.import_rooms()}

    @app.get("/api/rooms/{room_name}")
    def get_room(room_name: str) -> dict[str, Any]:
        return service.get_room(room_name).to_dict()

    @app.patch("/api/rooms/{room_name}")
    def update_room(room_name: str, body: RoomUpdate) -> dict[str, Any]:
        changes = {key: round(value) for key, value in body.model_dump(exclude_none=True).items()}
        return service.update_room(room_name, **changes).to_dict()

    @app.delete("/api/rooms/{room_name}")
    def delete_room(room_name: str) -> dict[str, str]:
        service.remove_room(room_name)
        return {"status": "deleted"}

    @app.post("/api/rooms/{room_name}/lights")
    def place_light(room_name: str, body: LightPlacement) -> dict[str, Any]:
        light = service.assign_light(room_name, body.light_id, x=round(body.x), y=round(body.y), label=body.label)
        return light.to_dict()

    @app.delete("/api/rooms/{room_name}/lights/{light_id}")
    def remove_light(room_name: str, light_id: str) -> dict[str, str]:
        service.remove_light(room_name, light_id)
        return {"status": "removed"}

    # Lights and other bridge resources

    @app.get("/api/lights")
    def list_lights() -> list[dict[str, Any]]:
        return service.lights()

    @app.put("/api/lights/{light_id}/state")
    def update_light_state(light_id: str, body: LightState) -> dict[str, str]:
        service.set_light(light_id, **body.model_dump(exclude_none=True))
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

    return app


app = create_app()
