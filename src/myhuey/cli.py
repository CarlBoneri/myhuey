"""Command line interface: `myhuey <command>`."""

from __future__ import annotations

import argparse
import json
import math
import socket
import sys
from typing import Any, Sequence, TextIO

from .errors import HueError
from .hue import PAIRING_WINDOW, HueBridgeClient
from .modes import ALIASES, MODES
from .layouts import using_layout
from .service import HueRoomService
from .setup import run_setup
from .tls import fingerprint, load_pin
from .geometry import fit_image
from .units import format_length, parse_length


def _parse_bool(value: str) -> bool:
    text = value.strip().lower()
    if text in {"1", "true", "yes", "on"}:
        return True
    if text in {"0", "false", "no", "off"}:
        return False
    raise argparse.ArgumentTypeError(f"expected on or off, got {value!r}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="myhuey", description="Philips Hue room planner and control client")
    parser.add_argument("--db", metavar="PATH", help="Storage file (default: ~/.myhuey/myhuey.db)")
    parser.add_argument("--layout", metavar="NAME_OR_ID",
                        help="Work on this saved layout instead of the active one (see `myhuey layouts`)")
    subparsers = parser.add_subparsers(dest="command", required=True)

    discover = subparsers.add_parser("discover", help="List the Hue bridges on this network")
    discover.set_defaults(handler=handle_discover)

    bridge = subparsers.add_parser("bridge", help="Pair with a Hue bridge, or check the pairing")
    bridge.add_argument(
        "action",
        choices=["setup", "register", "status"],
        help="setup: guided pairing. register: the same for one --bridge-ip. status: check the saved pairing",
    )
    bridge.add_argument("--bridge-ip", help="Bridge address, for example 192.168.1.50")
    bridge.add_argument("--app-name", default="myhuey", help="Name the bridge lists this app under")
    bridge.add_argument("--range", action="append", default=[], help="Extra address or CIDR range to offer")
    bridge.add_argument(
        "--timeout",
        type=float,
        default=PAIRING_WINDOW,
        help=f"Seconds to wait for the link button (default: {PAIRING_WINDOW:.0f})",
    )
    bridge.add_argument("--force", action="store_true", help="Pair again even if the saved pairing still works")
    bridge.set_defaults(handler=handle_bridge)

    room = subparsers.add_parser(
        "room",
        help="Manage rooms, their shape, and where lights sit in them",
        description="Lengths take units: 12ft, 12'6\", 3.8m, 380cm. A bare number is feet "
        "(imperial rooms) or meters (metric rooms). Positions --x/--y are in cm from the room's corner.",
    )
    room.add_argument(
        "action",
        choices=["list", "show", "create", "update", "assign", "remove-light", "delete", "import", "refresh", "photo", "remove-photo", "on", "off", "dim",
                 "tags", "tag", "untag", "plan-light", "swap"],
    )
    room.add_argument("--apply", action="store_true", help="Apply the refresh after showing it (refresh)")
    room.add_argument("--name", help="Room name")
    room.add_argument("--new-name", help="Rename the room (update)")
    room.add_argument("--light-id", help="Hue light ID")
    room.add_argument("--x", type=float, default=0, help="cm")
    room.add_argument("--y", type=float, default=0, help="cm")
    room.add_argument("--rotation", type=float, help="Degrees, for assign")
    room.add_argument("--length", help="Lightstrip or string length, for assign (for example 2m or 6ft)")
    room.add_argument("--catalog", help="Catalog product for plan-light (see `myhuey catalog`)")
    room.add_argument("--real", help="Real light ID from the bridge, for swap")
    room.add_argument("--item", help="Photo tag, for tag and untag: light:<id>, furniture:<id>, or opening:<id>")
    room.add_argument("--elevation", help="Height of the light, for assign (for example 120cm or 4ft), or auto")
    room.add_argument("--role", choices=["auto", "bias", "task", "view"],
                      help="Pin the light's role for suggested scenes, for assign (default auto)")
    room.add_argument("--label", default=None)
    room.add_argument("--width", help="Room width, for example 14ft or 4.5m")
    room.add_argument("--height", help="Room depth, for example 10ft 6in or 3.2m")
    room.add_argument("--outline", help='Corners as "x,y x,y x,y ..." in the room\'s units, for example "0,0 14,0 14,10 0,10"')
    room.add_argument("--units", choices=["imperial", "metric"])
    room.add_argument("--file", help="Photo of the room, for photo")
    room.add_argument("--level", type=float, help="Brightness 1 to 100 percent, for dim (lights that are off stay off)")
    room.set_defaults(handler=handle_room)

    layouts = subparsers.add_parser(
        "layouts", help="Saved layouts: one is active and runs the app, the others are sandboxes to try out"
    )
    layouts.add_argument("action", choices=["list", "new", "duplicate", "rename", "activate", "delete"])
    layouts.add_argument("layout", nargs="?", metavar="NAME_OR_ID",
                         help="The layout (name or ID); for new, the new layout's name")
    layouts.add_argument("--name", help="Name for duplicate and rename")
    layouts.set_defaults(handler=handle_layouts)

    groups = subparsers.add_parser(
        "groups", help="Saved light groups: named sets of lights, with an optional saved look to put back in one go"
    )
    groups.add_argument("action", choices=["list", "new", "rename", "delete", "save-look", "clear-look", "apply"])
    groups.add_argument("group", nargs="?", metavar="NAME_OR_ID", help="The group (not needed for list and new)")
    groups.add_argument("--name", help="Name for new and rename")
    groups.add_argument("--lights", help="Light IDs for new, comma separated, for example 1,2,5")
    groups.set_defaults(handler=handle_groups)

    prefs = subparsers.add_parser("prefs", help="Show or change app preferences (shared with the web app)")
    prefs.add_argument("action", choices=["show", "set"])
    prefs.add_argument("--key", help="Preference name, for set")
    prefs.add_argument("--value", help="New value, for set (true/false, a number, or a word)")
    prefs.set_defaults(handler=handle_prefs)

    furniture = subparsers.add_parser("furniture", help="Add or remove furniture in a room")
    furniture.add_argument("action", choices=["list", "add", "remove"])
    furniture.add_argument("--room", required=True)
    furniture.add_argument("--id", help="Furniture ID, for remove")
    furniture.add_argument("--kind", default="custom", help="sofa, bed, table, desk, tv, rug, ...")
    furniture.add_argument("--label")
    furniture.add_argument("--width", default="3ft", help="Width, for example 7ft or 2.1m")
    furniture.add_argument("--depth", default="3ft", help="Depth, for example 3ft or 90cm")
    furniture.add_argument("--x", type=float, default=0, help="Center, cm")
    furniture.add_argument("--y", type=float, default=0, help="Center, cm")
    furniture.add_argument("--rotation", type=float, default=0)
    furniture.add_argument("--shape", choices=["rect", "ellipse"], default="rect")
    furniture.set_defaults(handler=handle_furniture)

    scene = subparsers.add_parser("scene", help="List, build, and apply scenes painted onto rooms")
    scene.add_argument("action", choices=["list", "show", "create", "zone", "image", "preview", "apply", "delete"])
    scene.add_argument("--scene", help="Scene ID or name")
    scene.add_argument("--name", help="Scene name, for create")
    scene.add_argument("--room", help="Room name, for create and list")
    scene.add_argument("--base-mode", choices=["off", "keep", "color", "nearest"], default="off",
                       help="What lights outside every zone do")
    scene.add_argument("--color", default="#ffffff", help="Hex color for the base or a zone")
    scene.add_argument("--brightness", type=float, default=100, help="0 to 100")
    scene.add_argument("--rect", help='Zone rectangle "x,y,width,height" in cm')
    scene.add_argument("--file", help="Image to lay over the whole room, for image")
    scene.add_argument("--mood", default="colorful", help="Palette mood for image: colorful, bright, muted, deep, dark")
    scene.add_argument("--rotation", type=float, default=0, help="Degrees to turn the image clockwise, for image")
    scene.set_defaults(handler=handle_scene)

    palette = subparsers.add_parser("palette", help="Extract a color theme from an image file")
    palette.add_argument("--file", required=True)
    palette.add_argument("--mood", default="colorful", choices=["colorful", "bright", "muted", "deep", "dark"])
    palette.add_argument("--count", type=int, default=5)
    palette.set_defaults(handler=handle_palette)

    suggest = subparsers.add_parser("suggest", help="Suggest scenes for a room from a mode, the time, and its layout")
    suggest.add_argument("--room", required=True, help="Room name")
    suggest.add_argument("--mode", required=True, choices=[*MODES, *ALIASES], help="What you are doing")
    suggest.add_argument("--at", help="Time of day HH:MM (default now)")
    suggest.add_argument("--palette", help="Palette ID (see `myhuey palettes`); default: myhuey picks")
    suggest.add_argument("--count", type=int, default=4, choices=range(1, 7), metavar="1-6")
    suggest.add_argument("--seed", type=int, default=0, help="Change it for different picks")
    suggest.add_argument("--save", metavar="NAME", help="Save the first suggestion as a scene with this name")
    suggest.add_argument("--apply", action="store_true", help="Send the first suggestion to the lights")
    suggest.set_defaults(handler=handle_suggest)

    setups = subparsers.add_parser("setups", help="Propose lighting setups for a room's desk, before buying anything")
    setups.add_argument("--room", required=True)
    setups.add_argument("--at", help="Time of day HH:MM for the scene summaries (default now)")
    setups.add_argument("--add", type=int, metavar="N", help="Add setup N (from the list) to the room as planned lights")
    setups.set_defaults(handler=handle_setups)

    hue = subparsers.add_parser("hue-scenes", help="List the Hue app's scene gallery, or recreate one of its scenes in a room")
    hue.add_argument("--room", help="Room to recreate the scene in")
    hue.add_argument("--set", help="Scene set, such as Cozy or Defaults")
    hue.add_argument("--scene", help="Scene name, such as Savanna sunset")
    hue.add_argument("--save", action="store_true", help="Save the recreated scene")
    hue.add_argument("--apply", action="store_true", help="Send the recreated scene to the lights")
    hue.set_defaults(handler=handle_hue_scenes)

    catalog = subparsers.add_parser("catalog", help="List the Hue products you can plan with")
    catalog.set_defaults(handler=handle_catalog)

    palettes = subparsers.add_parser("palettes", help="Browse the palette library suggestions choose from")
    palettes.add_argument("--tag", help="warm, cool, muted, vivid, analogous, accent, blue_heavy")
    palettes.add_argument("--search", help="Text in the palette name")
    palettes.add_argument("--limit", type=int, default=20)
    palettes.set_defaults(handler=handle_palettes)

    lights = subparsers.add_parser("lights", help="List or change the lights on the paired bridge")
    lights.add_argument("action", choices=["list", "set", "gradient", "effect"])
    lights.add_argument("--light-id", help="Hue light ID")
    lights.add_argument("--on", type=_parse_bool, metavar="on|off")
    lights.add_argument("--brightness", type=int, help="1 to 254")
    lights.add_argument("--color", help="Hex color such as #ff8000")
    lights.add_argument("--color-temp", type=float, help="Color temperature in Kelvin, such as 2700")
    lights.add_argument("--colors", help='Gradient colors start to end, for gradient: "#ff0000,#0000ff" (2 to 5)')
    lights.add_argument(
        "--mode",
        help="Gradient mode: interpolated_palette, interpolated_palette_mirrored, segmented_palette, random_pixelated",
    )
    lights.add_argument("--effect", help="Effect, for effect: candle, fire, prism, sparkle, opal, ... or no_effect")
    lights.set_defaults(handler=handle_lights)

    serve = subparsers.add_parser("serve", help="Run the MyHuey web app")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8000)
    serve.set_defaults(handler=handle_serve)

    mcp = subparsers.add_parser("mcp", help="Run a tool server (MCP, over stdio) for an AI assistant")
    mcp.add_argument("--app-url", default="http://127.0.0.1:8000", help="Where the web app runs, for open_in_app")
    mcp.add_argument("--list", action="store_true", help="List the tools the server offers, then exit")
    mcp.set_defaults(handler=handle_mcp)

    return parser


class _Countdown:
    """A one-line countdown on a terminal that rewrites itself in place."""

    def __init__(self, stream: TextIO) -> None:
        self.stream = stream
        self.active = False

    def update(self, bridge_ip: str, remaining: float) -> None:
        self.stream.write(f"\r  Waiting for the link button on {bridge_ip}: {math.ceil(remaining):2d}s left ")
        self.stream.flush()
        self.active = True

    def finish(self) -> None:
        if self.active:
            self.stream.write("\n")
            self.stream.flush()
            self.active = False

    def print(self, message: str = "") -> None:
        self.finish()
        print(message, file=self.stream)


def handle_discover(_: argparse.Namespace) -> int:
    from .discovery import discover

    bridges = discover(report=print)
    if not bridges:
        print("No Hue bridges were found on this network.")
        return 1
    for bridge in bridges:
        print(f"{bridge.get('internalipaddress', '?')}  (id {bridge.get('id') or '?'}, found by {bridge.get('source', '?')})")
    return 0


def handle_bridge(args: argparse.Namespace) -> int:
    if args.action == "status":
        return _bridge_status(HueRoomService(args.db))
    if args.action == "register" and not args.bridge_ip:
        raise ValueError("--bridge-ip is required for `bridge register`. Use `bridge setup` to pick one.")

    countdown = _Countdown(sys.stdout)
    try:
        run_setup(
            bridge_ip=args.bridge_ip,
            app_name=args.app_name,
            preferred_ranges=args.range,
            storage_path=args.db,
            window=args.timeout,
            force=args.force,
            print_func=countdown.print,
            input_func=input,
            on_wait=countdown.update if sys.stdout.isatty() else None,
        )
    finally:
        countdown.finish()
    return 0


def _bridge_status(service: HueRoomService) -> int:
    bridge = service.get_bridge()
    if not bridge:
        print("No Hue bridge is paired. Run `myhuey bridge setup`.")
        return 1

    host, port = HueBridgeClient.normalize_bridge_endpoint(bridge["ip"])
    pem = load_pin(host, port, service.cert_dir)
    print(f"Bridge: {bridge['ip']} (pairing saved in {service.storage_path})")
    print(f"Certificate pin: {'SHA-256 ' + fingerprint(pem) if pem else 'none yet, pinned on first contact'}")
    print(f"Reachable: yes, {len(service.lights())} lights")
    return 0


def _outline(text: str, units: str) -> list[list[float]]:
    points = []
    for pair in text.replace(";", " ").split():
        x, _, y = pair.partition(",")
        points.append([parse_length(x, units), parse_length(y, units)])
    return points


def _describe_room(room) -> str:
    size = f"{format_length(room.width, room.units)} x {format_length(room.height, room.units)}"
    return f"{room.name}: {size}, {len(room.outline)} corners, {len(room.lights)} lights, {len(room.furniture)} furniture"


def _layout_line(entry: dict[str, Any]) -> str:
    mark, active = ("* ", " (active)") if entry["active"] else ("  ", "")
    return f"{mark}{entry['name']}{active} · {entry['rooms']} rooms · {entry['scenes']} scenes · {entry['id']}"


def handle_layouts(args: argparse.Namespace) -> int:
    service = HueRoomService(args.db)
    if args.action == "list":
        for entry in service.layouts():
            print(_layout_line(entry))
        return 0
    if args.action == "new":
        print(f"Started {service.new_layout(args.layout)['name']}, a sandbox. Open it with --layout.")
        return 0
    if not args.layout:
        raise ValueError(f"`layouts {args.action}` needs a layout name or ID")
    layout_id = service.resolve_layout(args.layout)
    if args.action == "duplicate":
        print(f"Copied into {service.new_layout(args.name, from_layout=layout_id)['name']}, a sandbox.")
    elif args.action == "rename":
        if not args.name:
            raise ValueError("`layouts rename` needs --name")
        print(f"Renamed to {service.rename_layout(layout_id, args.name)['name']}.")
    elif args.action == "activate":
        print(f"{service.activate_layout(layout_id)['name']} is now the active layout.")
    else:
        name = next(entry["name"] for entry in service.layouts() if entry["id"] == layout_id)
        service.delete_layout(layout_id)
        print(f"Deleted {name}.")
    return 0


def _group_line(group: dict[str, Any]) -> str:
    look = "look saved" if group.get("look") else "no look"
    return f"{group['name']} · {len(group['lights'])} lights ({', '.join(group['lights'])}) · {look} · {group['id']}"


def handle_groups(args: argparse.Namespace) -> int:
    service = HueRoomService(args.db)
    if args.action == "list":
        listed = service.groups()
        print("\n".join(_group_line(group) for group in listed) if listed else "No groups yet.")
        return 0
    if args.action == "new":
        if not args.name or not args.lights:
            raise ValueError("`groups new` needs --name and --lights")
        print(f"Saved {service.create_group(args.name, args.lights.split(','))['name']}.")
        return 0
    if not args.group:
        raise ValueError(f"`groups {args.action}` needs a group name or ID")
    if args.action == "rename":
        if not args.name:
            raise ValueError("`groups rename` needs --name")
        print(f"Renamed to {service.update_group(args.group, name=args.name)['name']}.")
    elif args.action == "delete":
        service.delete_group(args.group)
        print(f"Deleted {args.group}.")
    elif args.action == "save-look":
        group = service.save_group_look(args.group)
        print(f"Saved how the {len(group.get('look') or {})} lights in {group['name']} look now.")
    elif args.action == "clear-look":
        print(f"Cleared the look for {service.clear_group_look(args.group)['name']}.")
    else:
        results = service.apply_group(args.group)
        ok = sum(1 for item in results if item["ok"])
        print(f"{ok} lights set.")
        for item in results:
            if not item["ok"]:
                print(f"  {item['label']}: {item.get('error')}", file=sys.stderr)
        return 0 if ok == len(results) else 1
    return 0


def handle_prefs(args: argparse.Namespace) -> int:
    from .preferences import PREFERENCES, parse_value

    service = HueRoomService(args.db)
    if args.action == "set":
        if not args.key or args.value is None:
            raise ValueError("`prefs set` needs --key and --value")
        service.update_preferences({args.key: parse_value(args.value, args.key)})
    for key, value in service.preferences().items():
        _, allowed = PREFERENCES[key]
        options = ("true/false" if allowed is bool else f"{allowed.start}-{allowed.stop - 1}" if isinstance(allowed, range)
                   else "/".join(str(item) for item in allowed))
        print(f"{key}: {str(value).lower() if isinstance(value, bool) else value}  ({options})")
    return 0


def _refresh_line(change: dict) -> str:
    name = change["room"]
    if change["link"] and change.get("hue_name") and change["hue_name"] != name:
        name = f"{name} (Hue: {change['hue_name']})"
    if change["status"] == "left_alone":
        return f"{name}: not on the bridge, left alone"
    if change["status"] == "new":
        count = len(change["arrive"])
        return f"{name}: new room, {count} light{'' if count == 1 else 's'}"

    def part(sign: str, move: dict, word: str) -> str:
        if move["other"] and move.get("also"):
            word = "also in"
        where = f" ({word} {move['other']})" if move["other"] else ""
        return f"{sign} {move['label']}{where}"

    parts = [part("+", m, "from") for m in change["arrive"]] + [part("−", m, "to") for m in change["leave"]]
    return f"{name}: {', '.join(parts)}"


def handle_room(args: argparse.Namespace) -> int:
    service = HueRoomService(args.db)
    if args.action == "list":
        print(json.dumps([room.to_dict() for room in service.rooms()], indent=2))
        return 0
    if args.action == "refresh":
        preview = service.refresh_preview()
        lines = [_refresh_line(change) for change in preview["rooms"] if change["status"] != "unchanged"]
        if not any(change["status"] in ("new", "changed") for change in preview["rooms"]):
            lines.append("Rooms already match Hue.")
        print("\n".join(lines))
        if args.apply and any(change["status"] in ("new", "changed") or change["link"] for change in preview["rooms"]):
            service.refresh_rooms(preview["fingerprint"])
            print("Applied.")
        return 0
    if args.action == "import":
        added = service.import_rooms()
        print(f"Imported: {', '.join(added)}" if added else "No new rooms to import.")
        return 0

    if not args.name:
        raise ValueError(f"--name is required for `room {args.action}`")
    units = args.units or (service.get_room(args.name).units if args.action not in ("create",) else "imperial")
    if args.action == "show":
        print(json.dumps(service.get_room(args.name).to_dict(), indent=2))
    elif args.action == "create":
        width = parse_length(args.width or "14ft 9in", units)
        height = parse_length(args.height or "9ft 10in", units)
        outline = _outline(args.outline, units) if args.outline else None
        room = service.add_room(args.name, width, height, outline)
        if args.units:
            room = service.update_room(room.name, units=args.units)
        print(f"Created {_describe_room(room)}")
    elif args.action == "update":
        room = service.update_room(
            args.name,
            width=parse_length(args.width, units) if args.width else None,
            height=parse_length(args.height, units) if args.height else None,
            outline=_outline(args.outline, units) if args.outline else None,
            units=args.units,
            new_name=args.new_name,
        )
        print(f"Updated {_describe_room(room)}")
    elif args.action in ("on", "off"):
        results = service.set_room_power(args.name, args.action == "on")
        failed = [item for item in results if not item["ok"]]
        print(f"Turned {args.action} {len(results) - len(failed)} lights in {args.name}.")
        for item in failed:
            print(f"  {item['label']}: {item['error']}")
        return 1 if failed else 0
    elif args.action == "dim":
        if args.level is None:
            raise ValueError("--level is required for `room dim` (1 to 100)")
        results = service.set_room_brightness(args.name, args.level)
        failed = [item for item in results if not item["ok"]]
        print(f"Set {len(results) - len(failed)} lights in {args.name} to {args.level:g}%.")
        for item in failed:
            print(f"  {item['label']}: {item['error']}")
        return 1 if failed else 0
    elif args.action == "delete":
        service.remove_room(args.name)
        print(f"Deleted room '{args.name}'.")
    elif args.action == "photo":
        if not args.file:
            raise ValueError("--file is required for `room photo`")
        with open(args.file, "rb") as handle:
            room = service.set_room_photo(args.name, handle.read())
        print(f"Saved a {room.photo.width}x{room.photo.height} photo for '{room.name}'.")
    elif args.action == "plan-light":
        if not args.catalog:
            raise ValueError("--catalog is required for `room plan-light`")
        light = service.add_planned_light(args.name, args.catalog, x=args.x, y=args.y, label=args.label,
                                          rotation=args.rotation, elevation=_elevation_arg(args.elevation, units))
        print(json.dumps(light.to_dict(), indent=2))
    elif args.action == "swap":
        if not args.light_id or not args.real:
            raise ValueError("--light-id (the planned light) and --real are required for `room swap`")
        light = service.swap_planned_light(args.name, args.light_id, args.real)
        print(f"Light {light.light_id} now stands where '{light.label}' was planned.")
    elif args.action in ("tags", "tag", "untag"):
        return _photo_tags(service, args)
    elif args.action == "remove-photo":
        service.remove_room_photo(args.name)
        print(f"Removed the photo of '{args.name}'.")
    elif not args.light_id:
        raise ValueError(f"--light-id is required for `room {args.action}`")
    elif args.action == "assign":
        light = service.assign_light(
            args.name,
            args.light_id,
            x=args.x,
            y=args.y,
            label=args.label,
            rotation=args.rotation,
            length=parse_length(args.length, units) if args.length else None,
            elevation=_elevation_arg(args.elevation, units),
            role=args.role,
        )
        print(json.dumps(light.to_dict(), indent=2))
    else:
        service.remove_light(args.name, args.light_id)
        print(f"Removed light {args.light_id} from '{args.name}'.")
    return 0


def handle_furniture(args: argparse.Namespace) -> int:
    service = HueRoomService(args.db)
    room = service.get_room(args.room)
    if args.action == "list":
        for item in room.furniture:
            size = f"{format_length(item.width, room.units)} x {format_length(item.depth, room.units)}"
            print(f"{item.id}  {item.label} ({item.kind}), {size} at {item.x:.0f},{item.y:.0f} cm")
        return 0
    if args.action == "remove":
        if not args.id:
            raise ValueError("--id is required for `furniture remove`")
        service.remove_furniture(args.room, args.id)
        print(f"Removed furniture {args.id}.")
        return 0
    piece = service.add_furniture(
        args.room,
        {
            "kind": args.kind,
            "label": args.label or args.kind,
            "width": parse_length(args.width, room.units),
            "depth": parse_length(args.depth, room.units),
            "x": args.x,
            "y": args.y,
            "rotation": args.rotation,
            "shape": args.shape,
        },
    )
    print(f"Added {piece.label} ({piece.id}).")
    return 0


def _print_results(results: list[dict]) -> None:
    for item in results:
        if item.get("keep"):
            what = "unchanged"
        elif not item["on"]:
            what = "off"
        else:
            what = f"{item['color']} at {item['brightness']:.0f}%"
            if item.get("gradient"):
                what += f", gradient {' '.join(item['gradient'])}"
        if item.get("error"):
            what += f"  FAILED: {item['error']}"
        print(f"  {item['light_id']:>4}  {item['label']}: {what}")


def handle_scene(args: argparse.Namespace) -> int:
    service = HueRoomService(args.db)
    if args.action == "list":
        for scene in service.scenes(args.room):
            extras = f"{len(scene.zones)} zones" + (", image" if scene.image else "")
            print(f"{scene.id}  {scene.name}  ({scene.room}; {extras})")
        return 0
    if args.action == "create":
        if not (args.name and args.room):
            raise ValueError("--name and --room are required for `scene create`")
        scene = service.save_scene(
            {
                "name": args.name,
                "room": args.room,
                "base_mode": args.base_mode,
                "base_color": args.color,
                "base_brightness": args.brightness,
            }
        )
        print(f"Created scene {scene.id} '{scene.name}' in {scene.room}.")
        return 0

    if not args.scene:
        raise ValueError(f"--scene is required for `scene {args.action}`")
    scene = service.get_scene(args.scene)
    if args.action == "show":
        print(json.dumps(scene.to_dict(), indent=2))
    elif args.action == "delete":
        service.delete_scene(scene.id)
        print(f"Deleted scene '{scene.name}'.")
    elif args.action == "zone":
        if not args.rect:
            raise ValueError('--rect "x,y,width,height" is required for `scene zone`')
        x, y, w, h = (float(part) for part in args.rect.split(","))
        data = scene.to_dict()
        data["zones"].append(
            {"points": [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], "color": args.color, "brightness": args.brightness}
        )
        service.save_scene(data)
        print(f"Added a {args.color} zone to '{scene.name}'.")
    elif args.action == "image":
        if not args.file:
            raise ValueError("--file is required for `scene image`")
        with open(args.file, "rb") as handle:
            uploaded = service.upload_image(handle.read(), mood=args.mood)
        room = service.get_room(scene.room)
        xs = [p[0] for p in room.outline]
        ys = [p[1] for p in room.outline]
        placed = fit_image((min(xs), min(ys), max(xs), max(ys)), args.rotation, uploaded["width"] / uploaded["height"])
        data = scene.to_dict()
        data["image"] = {
            "file": uploaded["file"], **placed, "rotation": args.rotation % 360,
            "mood": args.mood, "picks": uploaded["theme"],
        }
        data["palette"] = [swatch["color"] for swatch in uploaded["theme"]]
        service.save_scene(data)
        print(f"Laid the image over '{scene.room}'. Palette: {' '.join(data['palette'])}")
    elif args.action == "preview":
        print(f"Scene '{scene.name}' in {scene.room}:")
        _print_results(service.preview_scene(scene))
    else:
        results = service.apply_scene(scene.id)
        print(f"Applied '{scene.name}' to {scene.room}:")
        _print_results(results)
        if any(item.get("error") for item in results):
            return 1
    return 0


def handle_suggest(args: argparse.Namespace) -> int:
    import re

    if args.at and not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", args.at):
        raise ValueError("--at takes a time such as 07:30 or 22:00")
    service = HueRoomService(args.db)
    items = service.suggest(args.room, args.mode, at=args.at, palette_id=args.palette, count=args.count, seed=args.seed)
    for number, item in enumerate(items, 1):
        palette = item["palette"]
        print(f"{number}. {item['scene']['name']}  ({palette['id']})  {' '.join(palette['colors'])}")
        for light in item["preview"]:
            shown = f"{light['color_temp']} K" if light.get("color_temp") else (light.get("color") or "off")
            role = item["roles"].get(light["light_id"], "")
            print(f"     {light['label']:<20} {role:<8} {shown:<9} {light['brightness']:>5}%")
    if not items:
        return 0
    first = items[0]["scene"]
    if args.save:
        saved = service.save_scene({**first, "id": None, "name": args.save})
        print(f"Saved '{saved.name}' ({saved.id}).")
    if args.apply:
        from .scenes import Scene

        results = service.apply_scene_object(Scene.from_dict(first))
        print(f"Applied '{first['name']}' to {args.room}:")
        _print_results(results)
        if any(item.get("error") for item in results):
            return 1
    return 0


def handle_setups(args: argparse.Namespace) -> int:
    service = HueRoomService(args.db)
    if args.add is not None:
        added = service.add_setup(args.room, args.add, at=args.at)
        print(f"Added {len(added)} planned lights to '{args.room}': {', '.join(light.label for light in added)}")
        return 0
    for number, setup in enumerate(service.setups(args.room, at=args.at)):
        print(f"{number}. {setup['name']}")
        if setup["hint"]:
            print(f"   {setup['hint']}")
        for light in setup["lights"]:
            print(f"   - {light['label']} ({light['role']}): {light['why']}")
        for mode, info in setup["modes"].items():
            print(f"   {mode:<6} {info['summary']} · palette {info['palette']}")
    return 0


def handle_hue_scenes(args: argparse.Namespace) -> int:
    from .hue_scenes import gallery
    from .scenes import Scene

    if not args.room:
        for group in gallery():
            print(f"{group['name']}: {', '.join(scene['name'] for scene in group['scenes'])}")
        return 0
    if not args.set or not args.scene:
        raise ValueError("--set and --scene are required with --room (see `myhuey hue-scenes`)")
    service = HueRoomService(args.db)
    made = service.hue_scene(args.room, args.set, args.scene)
    for light in made["preview"]:
        shown = f"{light['color_temp']} K" if light.get("color_temp") else (light.get("color") or "off")
        print(f"  {light['label']:<24} {shown:<9} {light['brightness']:>5}%")
    if args.save:
        saved = service.save_scene(made["scene"])
        print(f"Saved '{saved.name}' ({saved.id}).")
    if args.apply:
        results = service.apply_scene_object(Scene.from_dict(made["scene"]))
        _print_results(results)
        if any(item.get("error") for item in results):
            return 1
    return 0


def handle_catalog(args: argparse.Namespace) -> int:
    from .catalog import CATALOG

    for item in CATALOG.values():
        print(f"{item.id:<18} {item.label:<38} {item.color:<9} good for: {item.kind}")
    return 0


def handle_palettes(args: argparse.Namespace) -> int:
    from .palettes import search

    for palette in search(tag=args.tag, q=args.search, limit=args.limit):
        print(f"{palette.id:<22} {palette.name:<36} {' '.join(palette.colors)}  [{', '.join(palette.tags)}]")
    return 0


def handle_palette(args: argparse.Namespace) -> int:
    from .images import theme_from_bytes

    with open(args.file, "rb") as handle:
        theme = theme_from_bytes(handle.read(), args.count, args.mood)
    for swatch in theme:
        print(f"{swatch['color']}  at {swatch['x']:.0%} across, {swatch['y']:.0%} down")
    return 0


def handle_lights(args: argparse.Namespace) -> int:
    service = HueRoomService(args.db)
    if args.action == "list":
        print(json.dumps(service.lights(), indent=2))
        return 0

    if not args.light_id:
        raise ValueError(f"--light-id is required for `lights {args.action}`")
    if args.action == "gradient":
        colors = [part.strip() for part in (args.colors or "").split(",") if part.strip()]
        service.set_gradient(args.light_id, colors, args.mode)
        print(f"Set a {len(colors)}-color gradient on light {args.light_id}.")
        return 0
    if args.action == "effect":
        if not args.effect:
            raise ValueError("--effect is required for `lights effect`")
        service.set_effect(args.light_id, args.effect)
        print(f"Light {args.light_id} effect: {args.effect}.")
        return 0
    changes = {
        "on": args.on,
        "brightness": args.brightness,
        "color": args.color,
        "color_temp": args.color_temp,
    }
    service.set_light(args.light_id, **{key: value for key, value in changes.items() if value is not None})
    print(f"Updated light {args.light_id}.")
    return 0


def handle_mcp(args: argparse.Namespace) -> int:
    from . import mcp_server

    if args.list:
        from .assistant import TOOLS

        for name, tool in TOOLS.items():
            print(f"{name:<18}{(tool.__doc__ or '').strip().splitlines()[0]}")
        return 0
    mcp_server.run(args.db, args.app_url)
    return 0


def _require_free_port(host: str, port: int) -> None:
    if port == 0:
        return
    family = socket.AF_INET6 if ":" in host else socket.AF_INET
    with socket.socket(family, socket.SOCK_STREAM) as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind((host, port))
        except OSError as exc:
            raise ValueError(
                f"Cannot listen on {host}:{port} ({exc.strerror or exc}). Choose another port with --port, "
                f"or see what holds it with `lsof -nP -iTCP:{port} -sTCP:LISTEN`."
            ) from None


def handle_serve(args: argparse.Namespace) -> int:
    import uvicorn

    from .api import create_app

    _require_free_port(args.host, args.port)
    bridge = HueRoomService(args.db).get_bridge()
    if bridge:
        print(f"Using the Hue bridge at {bridge['ip']}.")
    else:
        print("No Hue bridge is paired yet. Run `myhuey bridge setup`, or pair from the web page.")
    uvicorn.run(create_app(args.db), host=args.host, port=args.port)
    return 0


def _photo_tags(service: HueRoomService, args: argparse.Namespace) -> int:
    room = service.get_room(args.name)
    if not room.photo:
        raise ValueError(f"Room '{room.name}' has no photo yet (add one with `room photo --file`)")
    tags = dict(room.photo.tags)
    if args.action == "tags":
        for key, spot in sorted(tags.items()):
            print(f"{key:<28} {spot['x']:.3f}, {spot['y']:.3f}")
        if not tags:
            print("Nothing is tagged on the photo yet.")
        return 0
    if not args.item:
        raise ValueError(f"--item is required for `room {args.action}`")
    if args.action == "untag":
        tags.pop(args.item, None)
    else:
        if not (0 <= args.x <= 1 and 0 <= args.y <= 1):
            raise ValueError("For `room tag`, --x and --y are fractions of the photo, 0 to 1")
        tags[args.item] = {**tags.get(args.item, {}), "x": args.x, "y": args.y}
    service.set_photo_tags(room.name, tags)
    print(f"{'Removed' if args.action == 'untag' else 'Tagged'} {args.item} on the photo of '{room.name}'.")
    return 0


def _elevation_arg(text: str | None, units: str) -> float | str | None:
    if text is None:
        return None
    return "auto" if text.strip().lower() == "auto" else parse_length(text, units)


def main(argv: Sequence[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    try:
        if args.layout and args.command not in ("layouts", "groups", "mcp"):  # app-wide, or (mcp) each tool takes its own
            service = HueRoomService(args.db)
            with using_layout(service.sandbox_id(service.resolve_layout(args.layout))):
                code = args.handler(args)
        else:
            code = args.handler(args)
    except KeyboardInterrupt:
        print("\nmyhuey: interrupted", file=sys.stderr)
        code = 130
    except (HueError, ValueError) as exc:
        print(f"myhuey: error: {exc}", file=sys.stderr)
        code = 1
    raise SystemExit(code)


if __name__ == "__main__":
    main()
