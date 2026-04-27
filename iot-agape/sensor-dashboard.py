"""
sensor-dashboard.py — VinelandEternal IoT Agape Dashboard
Real-time tray metrics served over Flask, with MQTT subscriber for live sensor updates.

Usage:
    pip install flask paho-mqtt
    python sensor-dashboard.py
    # Visit http://localhost:5000/api/agape/tray1
"""

import json
import threading

import paho.mqtt.client as mqtt
from flask import Flask, jsonify

app = Flask(__name__)

# In-memory store of latest sensor readings per tray.
# Each tray entry holds water (%), soil moisture (%), sunlight (lux),
# and a computed agape_value community-impact score.
sensors: dict = {
    # --- Vineland, NJ — founding sanctuary (East Coast) ---
    "tray1": {"crop": "Basil",        "water": 85, "soil": 72, "sun": 92, "agape_value": 97, "location": "Vineland, NJ"},
    "tray2": {"crop": "Arugula",      "water": 78, "soil": 68, "sun": 88, "agape_value": 91, "location": "Vineland, NJ"},
    "tray3": {"crop": "Pea Shoots",   "water": 90, "soil": 80, "sun": 75, "agape_value": 94, "location": "Vineland, NJ"},
    "tray4": {"crop": "Cilantro",     "water": 70, "soil": 65, "sun": 82, "agape_value": 88, "location": "Vineland, NJ"},
    "tray5": {"crop": "Baby Bok Choy","water": 83, "soil": 74, "sun": 86, "agape_value": 93, "location": "Vineland, NJ"},
    # --- Seattle, WA (West Coast node) ---
    "sea-tray1": {"crop": "Kale",         "water": 88, "soil": 78, "sun": 70, "agape_value": 81, "location": "Seattle, WA"},
    "sea-tray2": {"crop": "Swiss Chard",  "water": 82, "soil": 75, "sun": 68, "agape_value": 78, "location": "Seattle, WA"},
    # --- Portland, OR (West Coast node) ---
    "pdx-tray1": {"crop": "Sunflower",    "water": 80, "soil": 76, "sun": 88, "agape_value": 83, "location": "Portland, OR"},
    "pdx-tray2": {"crop": "Radish",       "water": 75, "soil": 70, "sun": 85, "agape_value": 77, "location": "Portland, OR"},
    # --- San Francisco, CA (West Coast node) ---
    "sf-tray1":  {"crop": "Mustard Greens","water": 91, "soil": 82, "sun": 95, "agape_value": 90, "location": "San Francisco, CA"},
    "sf-tray2":  {"crop": "Mizuna",        "water": 86, "soil": 79, "sun": 90, "agape_value": 85, "location": "San Francisco, CA"},
}

MQTT_BROKER = "localhost"
MQTT_PORT = 1883
MQTT_TOPIC = "vineland/trays/#"


def _compute_agape_value(water: int, soil: int, sun: int) -> int:
    """Compute a 0-100 community-impact score from sensor readings."""
    return min(100, int((water * 0.35 + soil * 0.35 + sun * 0.30)))


def on_mqtt_message(client, userdata, msg):
    """Handle incoming MQTT sensor payloads and update the in-memory store."""
    try:
        tray_id = msg.topic.split("/")[-1]
        payload = json.loads(msg.payload.decode())
        water = int(payload.get("water", 0))
        soil = int(payload.get("soil", 0))
        sun = int(payload.get("sun", 0))
        # Preserve existing location if the payload doesn't supply one
        existing_location = sensors.get(tray_id, {}).get("location", "Unknown")
        sensors[tray_id] = {
            "crop": payload.get("crop", "Unknown"),
            "water": water,
            "soil": soil,
            "sun": sun,
            "agape_value": _compute_agape_value(water, soil, sun),
            "location": payload.get("location", existing_location),
        }
    except (ValueError, KeyError):
        pass


def start_mqtt():
    """Start the MQTT subscriber in a background thread."""
    client = mqtt.Client()
    client.on_message = on_mqtt_message
    try:
        client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
        client.subscribe(MQTT_TOPIC)
        client.loop_forever()
    except OSError:
        # Broker not available — dashboard still serves seed data.
        pass


# ---------------------------------------------------------------------------
# API Routes
# ---------------------------------------------------------------------------

@app.route("/api/agape/<tray_id>")
def agape_metrics(tray_id: str):
    """Return the latest sensor metrics for a single tray."""
    data = sensors.get(tray_id)
    if data is None:
        return jsonify({"error": f"Tray '{tray_id}' not found", "status": "not_found"}), 404
    return jsonify({"tray_id": tray_id, **data})


@app.route("/api/agape")
def all_trays():
    """Return metrics for all trays."""
    return jsonify([{"tray_id": tid, **data} for tid, data in sensors.items()])


@app.route("/api/agape/surplus")
def surplus_trays():
    """Return trays whose agape_value exceeds the surplus threshold (>= 90)."""
    surplus = [
        {"tray_id": tid, **data}
        for tid, data in sensors.items()
        if data.get("agape_value", 0) >= 90
    ]
    return jsonify(surplus)


@app.route("/api/agape/region/<region>")
def trays_by_region(region: str):
    """Return metrics for all trays in a specific deployment region/location."""
    region_lower = region.lower().replace("-", " ")
    matched = [
        {"tray_id": tid, **data}
        for tid, data in sensors.items()
        if region_lower in data.get("location", "").lower()
    ]
    if not matched:
        return jsonify({"error": f"No trays found for region '{region}'", "status": "not_found"}), 404
    return jsonify(matched)


@app.route("/api/nexus/status")
def nexus_status():
    """Return a system-wide summary across all sanctuary nodes."""
    all_trays = list(sensors.items())
    surplus = [t for _, t in all_trays if t.get("agape_value", 0) >= 90]

    # Aggregate by location
    region_summary: dict = {}
    for tid, data in all_trays:
        loc = data.get("location", "Unknown")
        if loc not in region_summary:
            region_summary[loc] = {"trays": 0, "surplus": 0, "avg_agape": 0.0, "_agape_sum": 0.0}
        region_summary[loc]["trays"] += 1
        av = data.get("agape_value", 0)
        region_summary[loc]["_agape_sum"] += av
        if av >= 90:
            region_summary[loc]["surplus"] += 1

    for loc, summary in region_summary.items():
        count = summary["trays"]
        summary["avg_agape"] = round(summary.pop("_agape_sum") / count, 1) if count else 0.0

    return jsonify({
        "total_trays":      len(all_trays),
        "surplus_trays":    len(surplus),
        "regions_active":   len(region_summary),
        "region_breakdown": region_summary,
    })


@app.route("/health")
def health():
    return jsonify({"status": "ok", "trays_monitored": len(sensors)})


if __name__ == "__main__":
    mqtt_thread = threading.Thread(target=start_mqtt, daemon=True)
    mqtt_thread.start()
    app.run(host="0.0.0.0", port=5000)
