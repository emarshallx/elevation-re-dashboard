"""Elevation: a real estate asset management and market intelligence dashboard."""
from __future__ import annotations

import datetime as dt
import math

import numpy as np
from flask import Flask, render_template
from flask.json.provider import DefaultJSONProvider

from . import config


class NumpyJSONProvider(DefaultJSONProvider):
    """Let Flask serialise numpy / pandas scalars and turn NaN into null."""

    @staticmethod
    def _clean(o):
        if isinstance(o, dict):
            return {k: NumpyJSONProvider._clean(v) for k, v in o.items()}
        if isinstance(o, (list, tuple)):
            return [NumpyJSONProvider._clean(v) for v in o]
        if isinstance(o, np.generic):
            o = o.item()
        if isinstance(o, float) and (math.isnan(o) or math.isinf(o)):
            return None
        return o

    def dumps(self, obj, **kwargs):
        return super().dumps(self._clean(obj), **kwargs)

    @staticmethod
    def default(o):
        if isinstance(o, (dt.date, dt.datetime)):
            return o.isoformat()
        if isinstance(o, np.generic):
            return o.item()
        return DefaultJSONProvider.default(o)


def create_app() -> Flask:
    from .api import api
    from .seed import ensure_database

    ensure_database()
    app = Flask(__name__)
    app.json = NumpyJSONProvider(app)
    app.json.sort_keys = False
    app.register_blueprint(api, url_prefix="/api")

    @app.get("/")
    def index():
        return render_template("index.html", as_of=config.AS_OF)

    return app
