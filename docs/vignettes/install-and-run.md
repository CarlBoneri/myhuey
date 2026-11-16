# Install MyHuey and open the web app

You have a Hue bridge at home and want to plan your rooms from a browser on the same computer.
This walkthrough builds the web app, installs MyHuey into a Python virtual environment from a
source checkout, and starts the local server.

## What you need

- Python 3.11 or newer
- Node.js and npm
- A MyHuey source checkout
- A Philips Hue bridge on your local network if you want to pair lights now

MyHuey runs locally. The server binds to `127.0.0.1` by default, and the app talks directly to
your bridge over the home network.

## Build and install

From the repository root, create a virtual environment and install the Python package in
editable mode. Then install the frontend dependencies and build the browser app:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -e '.[dev]'
npm --prefix frontend install
npm --prefix frontend run build
```

The frontend build writes its files to `static/app`, where the MyHuey server looks for them.
Editable installation keeps the Python package connected to this checkout.

## Start the server

Check whether the default port is already in use before starting the server:

```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN
```

No output means nothing is listening on port 8000. If a process is listed, leave it alone and
choose an unused port instead. (MyHuey also refuses to start on a busy port and tells you to pick
another with `--port`; checking first just saves you the round trip.) For example:

```bash
lsof -nP -iTCP:8010 -sTCP:LISTEN
```

Use port 8010 only if that check also returns no output. Otherwise, check another port before
starting the server. For an unused port 8010:

```bash
.venv/bin/myhuey serve --host 127.0.0.1 --port 8010
```

Use the port you chose in the browser address and health check. For port 8010:

```bash
curl -s http://127.0.0.1:8010/api/health
```

Expected response:

```json
{"status":"ok","api":5}
```

For an unused default port, the equivalent address is
[http://127.0.0.1:8000](http://127.0.0.1:8000), and the health endpoint is
`http://127.0.0.1:8000/api/health`.

If the page says the web app has not been built, run `npm --prefix frontend run build` from the
repository root, then reload the page.

## Pair the bridge

The first-run screen walks through five steps: **Welcome**, **Find**, **Confirm**, **Link
button**, and **Connected**. Find locates the bridge, Confirm shows its address and ID so you can
check it is yours, and Link button waits while you press the round button on the bridge. At
Connected you can choose **Import rooms** to copy your Hue rooms, or **Not now**. Keep this
computer and the bridge on the same network, and be close enough to press the button when MyHuey
asks. **Skip for now** on the Welcome step leaves pairing for later.

You can also pair from a terminal:

```bash
.venv/bin/myhuey bridge setup
```

MyHuey stores its database, uploads, and pinned bridge certificate under `~/.myhuey`. If you skip
pairing, you can still open the app and draw rooms; importing rooms and controlling Hue lights
will wait until you connect a bridge.

## What this installs, and what it does not

This walkthrough runs the app from a source checkout. The Python package and the built web app
are separate parts of the deployment: the package serves the frontend bundle from `static/app`.
The current wheel build includes the Python modules and skills, but not that bundle. Installing
the wheel by itself and running `myhuey serve` therefore shows the build-not-found page instead
of the web app.

Do not treat the current wheel as a complete web-app release. Before publishing a wheel for
standalone deployment, include the built frontend assets in the package and verify the installed
wheel in a clean environment by checking both `/` and `/api/health`.

Keep the server on `127.0.0.1` unless you have a specific reason to let other devices reach it.
Binding to `0.0.0.0` makes the app reachable from the network and should be treated as an access
boundary change, not a routine deployment setting.
