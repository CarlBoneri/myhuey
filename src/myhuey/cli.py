"""Command line interface: `myhuey <command>`."""

from __future__ import annotations

import argparse
import json
import math
import socket
import sys
from typing import Sequence, TextIO

from .errors import HueError
from .hue import PAIRING_WINDOW, HueBridgeClient
from .service import HueRoomService
from .setup import run_setup
from .tls import fingerprint, load_pin


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

    room = subparsers.add_parser("room", help="Manage rooms and where lights sit in them")
    room.add_argument("action", choices=["list", "create", "assign", "remove-light", "delete", "import"])
    room.add_argument("--name", help="Room name")
    room.add_argument("--light-id", help="Hue light ID")
    room.add_argument("--x", type=int, default=0)
    room.add_argument("--y", type=int, default=0)
    room.add_argument("--label", default=None)
    room.add_argument("--width", type=int, default=900)
    room.add_argument("--height", type=int, default=600)
    room.set_defaults(handler=handle_room)

    lights = subparsers.add_parser("lights", help="List or change the lights on the paired bridge")
    lights.add_argument("action", choices=["list", "set"])
    lights.add_argument("--light-id", help="Hue light ID")
    lights.add_argument("--on", type=_parse_bool, metavar="on|off")
    lights.add_argument("--brightness", type=int, help="1 to 254")
    lights.add_argument("--color", help="Hex color such as #ff8000")
    lights.add_argument("--color-temp", type=float, help="Color temperature in Kelvin, such as 2700")
    lights.set_defaults(handler=handle_lights)

    serve = subparsers.add_parser("serve", help="Run the MyHuey web app")
    serve.add_argument("--host", default="127.0.0.1")
    serve.add_argument("--port", type=int, default=8000)
    serve.set_defaults(handler=handle_serve)

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
    bridges = HueBridgeClient.discover_bridges()
    if not bridges:
        print("No Hue bridges were found on this network.")
        return 1
    for bridge in bridges:
        print(f"{bridge.get('internalipaddress', '?')}  (id {bridge.get('id', '?')})")
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


def handle_room(args: argparse.Namespace) -> int:
    service = HueRoomService(args.db)
    if args.action == "list":
        print(json.dumps([room.to_dict() for room in service.rooms()], indent=2))
        return 0
    if args.action == "import":
        added = service.import_rooms()
        print(f"Imported: {', '.join(added)}" if added else "No new rooms to import.")
        return 0

    if not args.name:
        raise ValueError(f"--name is required for `room {args.action}`")
    if args.action == "create":
        print(json.dumps(service.add_room(args.name, args.width, args.height).to_dict(), indent=2))
    elif args.action == "delete":
        service.remove_room(args.name)
        print(f"Deleted room '{args.name}'.")
    elif not args.light_id:
        raise ValueError(f"--light-id is required for `room {args.action}`")
    elif args.action == "assign":
        light = service.assign_light(args.name, args.light_id, x=args.x, y=args.y, label=args.label)
        print(json.dumps(light.to_dict(), indent=2))
    else:
        service.remove_light(args.name, args.light_id)
        print(f"Removed light {args.light_id} from '{args.name}'.")
    return 0


def handle_lights(args: argparse.Namespace) -> int:
    service = HueRoomService(args.db)
    if args.action == "list":
        print(json.dumps(service.lights(), indent=2))
        return 0

    if not args.light_id:
        raise ValueError("--light-id is required for `lights set`")
    changes = {
        "on": args.on,
        "brightness": args.brightness,
        "color": args.color,
        "color_temp": args.color_temp,
    }
    service.set_light(args.light_id, **{key: value for key, value in changes.items() if value is not None})
    print(f"Updated light {args.light_id}.")
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


def main(argv: Sequence[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    try:
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
