# MyHuey

MyHuey is a local client application for Philips Hue ecosystems. It combines a Python CLI with a lightweight web interface so you can model each room, place lights in a physical layout, and drive the Hue bridge with granular commands.

## Features

- Discover Hue bridges on the local network using the official Hue discovery endpoint
- Register a local app with a Hue bridge using the documented press-link flow
- Maintain a room layout model for each physical room
- Place lights on a 2D canvas and assign the actual Hue bulb IDs to each position
- Control individual bulbs, brightness, and power state
- Serve a browser-based room planner and control dashboard

This follows the Philips Hue guidance for bridge discovery and room/group-based lighting control patterns.

## Quick start

1. Create a virtual environment and install dependencies

   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -e '.[dev]'
   ```

2. Discover Hue bridges

   ```bash
   myhuey discover
   ```

3. Register the app with the Hue bridge (press the bridge button when prompted)

   ```bash
   myhuey bridge register --bridge-ip 192.168.1.50 --app-name myhuey
   ```

4. Create a room and place lights

   ```bash
   myhuey room create --name "Living Room"
   myhuey room assign --name "Living Room" --light-id 1 --x 120 --y 90 --label "Ceiling lamp"
   ```

5. Run the web app

   ```bash
   myhuey serve --host 127.0.0.1 --port 8000
   ```

6. Open http://127.0.0.1:8000 and use the room editor to position bulbs visually.

## Example API usage

```bash
curl http://127.0.0.1:8000/api/rooms
curl -X POST http://127.0.0.1:8000/api/rooms -H 'Content-Type: application/json' -d '{"name":"Bedroom"}'
curl -X POST http://127.0.0.1:8000/api/rooms/Bedroom/lights -H 'Content-Type: application/json' -d '{"light_id":"2","label":"Bedside","x":180,"y":140,"brightness":200,"on":true}'
```

## Notes

This project is intentionally local-first. The bridge and room layout configuration are persisted in a JSON config at `~/.myhuey/config.json`.
