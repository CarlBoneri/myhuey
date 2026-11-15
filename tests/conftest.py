import pytest
import requests

USERNAME = "test-user-0123456789abcdef"


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def raise_for_status(self):
        if self.status_code >= 400:
            raise requests.exceptions.HTTPError(f"{self.status_code} error", response=self)

    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


class FakeSession:
    """Stands in for the pinned session. Records every call and replays queued answers."""

    def __init__(self, *answers):
        self.answers = list(answers)
        self.calls = []
        self.clip_calls = []
        self.v2_lights = []  # what GET /clip/v2/resource/light answers

    def request(self, method, url, **kwargs):
        if "/clip/v2/" in url:
            # v2 calls are recorded apart so v1 answer queues stay in order.
            self.clip_calls.append({"method": method, "url": url, **kwargs})
            data = self.v2_lights if method == "GET" else [{"rid": url.rsplit("/", 1)[1], "rtype": "light"}]
            return FakeResponse({"errors": [], "data": data})
        self.calls.append({"method": method, "url": url, **kwargs})
        answer = self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]
        if isinstance(answer, Exception):
            raise answer
        return answer if isinstance(answer, FakeResponse) else FakeResponse(answer)


LIGHTS = {
    "1": {
        "name": "Desk lamp",
        "type": "Extended color light",
        "state": {"on": True, "bri": 254, "xy": [0.5, 0.4], "ct": 366, "colormode": "xy", "reachable": True},
    },
    "2": {
        "name": "Hall",
        "type": "Dimmable light",
        "state": {"on": False, "bri": 100, "reachable": True},
    },
    "10": {
        "name": "Porch",
        "type": "Color temperature light",
        "state": {"on": True, "bri": 127, "ct": 370, "colormode": "ct", "reachable": False},
    },
}

GROUPS = {
    "1": {"name": "Office", "type": "Room", "lights": ["1", "2"]},
    "2": {"name": "Downstairs", "type": "Zone", "lights": ["10"]},
    "3": {"name": "Porch/Yard", "type": "Room", "lights": ["10"]},
}


class FakeClock:
    """Stands in for the time module in myhuey.hue. Sleeping moves the clock forward at once."""

    def __init__(self):
        self.now = 0.0

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


LINK_BUTTON = [{"error": {"type": 101, "address": "", "description": "link button not pressed"}}]
PAIRED = [{"success": {"username": USERNAME}}]
UNAUTHORIZED = [{"error": {"type": 1, "address": "/lights", "description": "unauthorized user"}}]


@pytest.fixture
def db_path(tmp_path):
    return str(tmp_path / "myhuey.db")


@pytest.fixture
def fake_bridge(monkeypatch):
    """Route every bridge connection to one FakeSession. Call it with the answers to replay."""

    def install(*answers):
        session = FakeSession(*answers)
        session.hosts = []

        def pinned(host, port=443, *, cert_dir=None):
            session.hosts.append(host)
            return session

        monkeypatch.setattr("myhuey.hue.pinned_session", pinned)
        return session

    return install


@pytest.fixture
def clock(monkeypatch):
    fake = FakeClock()
    monkeypatch.setattr("myhuey.hue.time", fake)
    return fake


@pytest.fixture(autouse=True)
def no_real_network(monkeypatch):
    """A test that forgets to fake the bridge fails loudly instead of touching the network."""

    def refuse(*args, **kwargs):
        raise AssertionError("A test tried to open a real connection to a bridge")

    monkeypatch.setattr("myhuey.tls.fetch_certificate", refuse)
    monkeypatch.setattr("myhuey.hue.requests.get", refuse)
    monkeypatch.setattr("myhuey.hue.time.sleep", lambda seconds: None)
