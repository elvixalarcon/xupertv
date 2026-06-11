#!/usr/bin/env python3
"""Addon mitmproxy: captura URLs ECDF/m3u8 de apps MXL/shinraitv."""

import re
from mitmproxy import http

KEYWORDS = ('shinraitv', 'kouzentv', 'kirasphere', 'saohgdasregions', 'mxliptv', 'bankai')
HITS_FILE = '/tmp/mxl-ecdf-hits.txt'


def _interesting(url: str, body: str) -> bool:
    u = url.lower()
    b = (body or '').lower()
    if any(k in u for k in KEYWORDS):
        return True
    return any(k in b for k in ('ecdf', 'm3u8', 'canal del futbol', 'data_token'))


class MxlCapture:
    def response(self, flow: http.HTTPFlow):
        text = flow.response.get_text(strict=False) or ''
        if not _interesting(flow.request.pretty_url, text):
            return

        lines = [
            f"\n[{flow.request.timestamp_start}] {flow.request.method} {flow.request.pretty_url}",
        ]
        auth = flow.request.headers.get('Authorization')
        if auth:
            lines.append(f"  Authorization: {auth[:120]}...")
        lines.append(f"  Status: {flow.response.status_code}")

        for m in re.findall(r'https?://[^\s"\'<>\\]+', text):
            low = m.lower()
            if 'm3u8' in low or 'ecdf' in low:
                lines.append(f"  >>> M3U/ECDF: {m}")
                with open(HITS_FILE, 'a', encoding='utf-8') as f:
                    f.write(m + '\n')

        if 'ecdf' in text.lower() and len(text) < 8000:
            lines.append(f"  Body snippet: {text[:500]}")

        block = '\n'.join(lines)
        print(block, flush=True)
        with open('/tmp/mxl-capture.log', 'a', encoding='utf-8') as f:
            f.write(block + '\n')


addons = [MxlCapture()]
