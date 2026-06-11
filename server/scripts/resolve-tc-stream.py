#!/usr/bin/env python3
import json
import re
import sys

try:
    from curl_cffi import requests
except ImportError:
    print(json.dumps({"ok": False, "error": "curl_cffi no instalado"}))
    sys.exit(1)

TC_PAGE = "https://tctelevision.com/envivo/"
TC_EMBEDDER = "https://tctelevision.com"
DEFAULT_VIDEO_ID = "x7wijay"


def pick_best_variant(body: str) -> str:
    lines = body.splitlines()
    best1080 = ""
    best720 = ""
    best_any = ""
    for i, line in enumerate(lines):
        if not line.startswith("#EXT-X-STREAM-INF"):
            continue
        nxt = lines[i + 1].split("#")[0].strip() if i + 1 < len(lines) else ""
        if not nxt.startswith("http"):
            continue
        if "1080" in line or "live-1080" in nxt:
            best1080 = nxt
        elif "720" in line or "live-720" in nxt:
            best720 = nxt
        if not best_any:
            best_any = nxt
    return best1080 or best720 or best_any


def get_json(session, url, headers, retries=4):
    last_err = ""
    for attempt in range(retries):
        res = session.get(url, headers=headers, timeout=25)
        if res.status_code < 400:
            return res
        last_err = f"HTTP {res.status_code}"
        if res.status_code not in (403, 429, 500, 502, 503, 504):
            break
    raise RuntimeError(last_err or "HTTP error")


def main():
    video_id = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_VIDEO_ID
    session = requests.Session(impersonate="chrome120")
    headers = {"Referer": TC_PAGE}
    last_error = "No se pudo resolver TC"

    for attempt in range(5):
        try:
            page = get_json(session, TC_PAGE, headers, retries=2)
            iframe = re.search(r"dailymotion\.com/player\.html\?video=([a-z0-9]+)", page.text, re.I)
            current_video_id = iframe.group(1) if iframe else video_id

            meta = get_json(
                session,
                f"https://www.dailymotion.com/player/metadata/video/{current_video_id}?embedder={TC_EMBEDDER}",
                headers,
                retries=2,
            )
            payload = meta.json()
            if payload.get("error", {}).get("code"):
                err = payload["error"].get("message") or payload["error"].get("code")
                raise RuntimeError(f"Dailymotion: {err}")

            director = (payload.get("qualities", {}).get("auto") or [{}])[0].get("url")
            if not director:
                raise RuntimeError("Sin URL M3U8 en metadata de TC")

            master = get_json(
                session,
                director,
                headers={**headers, "Origin": TC_EMBEDDER},
                retries=2,
            )
            if "#EXTM3U" not in master.text:
                raise RuntimeError(f"Manifest inválido (HTTP {master.status_code})")

            variant = pick_best_variant(master.text)
            if not variant:
                raise RuntimeError("Sin variante HLS en manifest de TC")

            probe = get_json(session, variant, headers=headers, retries=2)
            if "#EXTM3U" not in probe.text:
                raise RuntimeError(f"Variante HLS no accesible (HTTP {probe.status_code})")

            print(json.dumps({
                "ok": True,
                "stream_url": variant,
                "director_url": director,
                "video_id": current_video_id,
                "live_status": payload.get("live_public_status", ""),
                "title": payload.get("title", "TC Televisión")
            }))
            return
        except Exception as exc:
            last_error = str(exc)
            session = requests.Session(impersonate="chrome120")

    raise RuntimeError(last_error)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        sys.exit(1)
