#!/usr/bin/env python3
import json
import re
import sys

try:
    from curl_cffi import requests
except ImportError:
    print(json.dumps({"ok": False, "error": "curl_cffi no instalado"}))
    sys.exit(1)

GAMA_PAGE = "https://www.gamavision.com.ec/en-vivo/"
GAMA_HOME = "https://www.gamavision.com.ec/"
GAMA_REFERER = "https://www.gamavision.com.ec/"
DEFAULT_STREAM = "https://stream.esradioecuador.com/hls/stream.m3u8"


def find_m3u8_urls(text: str) -> list:
    found = re.findall(r"https?://[^\s\"'<>\\]+\.m3u8[^\s\"'<>\\]*", text or "", re.I)
    out = []
    seen = set()
    for url in found:
        url = url.rstrip("\\").split("#")[0].strip()
        if url not in seen:
            seen.add(url)
            out.append(url)
    return out


def probe_stream(session, url: str) -> bool:
    try:
        res = session.get(
            url,
            headers={"Referer": GAMA_REFERER, "Origin": "https://www.gamavision.com.ec"},
            timeout=20,
        )
        return res.status_code < 400 and "#EXTM3U" in res.text
    except Exception:
        return False


def main():
    session = requests.Session(impersonate="chrome120")
    headers = {"Referer": GAMA_REFERER}
    candidates = []

    for page_url in (GAMA_PAGE, GAMA_HOME):
        try:
            page = session.get(page_url, headers=headers, timeout=25)
            if page.status_code < 400:
                candidates.extend(find_m3u8_urls(page.text))
        except Exception:
            pass

    candidates.append(DEFAULT_STREAM)
    # Priorizar esradio / gamavision
    candidates.sort(key=lambda u: (
        0 if "esradioecuador.com" in u else 1,
        0 if "gamavision" in u else 1,
        len(u),
    ))

    stream_url = ""
    for url in candidates:
        if probe_stream(session, url):
            stream_url = url
            break

    if not stream_url:
        raise RuntimeError("Señal Gamavisión no accesible (403 o sin M3U8)")

    print(json.dumps({
        "ok": True,
        "stream_url": stream_url,
        "referer": GAMA_REFERER,
        "page_url": GAMA_PAGE,
        "title": "Gamavisión"
    }))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        sys.exit(1)
