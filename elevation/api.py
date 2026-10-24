"""JSON endpoints consumed by the front end (static/js)."""
from flask import Blueprint, abort, jsonify, request

from . import services

api = Blueprint("api", __name__)


def _filters():
    return request.args.get("region", "all"), request.args.get("sector", "all")


@api.get("/meta")
def meta():
    return jsonify(services.meta())


@api.get("/portfolio")
def portfolio():
    return jsonify(services.portfolio(*_filters()))


@api.get("/property/<pid>")
def property_detail(pid):
    data = services.property_detail(pid)
    if data is None:
        abort(404, description=f"No property with id {pid}")
    return jsonify(data)


@api.get("/financials")
def financials():
    return jsonify(services.financials(*_filters()))


@api.get("/markets")
def markets():
    return jsonify(services.market_intel())


@api.post("/valuation")
def valuation():
    return jsonify(services.valuation(request.get_json(force=True) or {}))
