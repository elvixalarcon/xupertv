#!/usr/bin/env python3
"""Decrypt MXL IPTV (tv-phones.apk) init/application properties using Keyczar keys from the APK."""

import base64
import json
import sys
from pathlib import Path

from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import padding, rsa


def b64ws_decode(s: str) -> bytes:
    s = s.replace('-', '+').replace('_', '/')
    pad = '=' * ((4 - len(s) % 4) % 4)
    return base64.b64decode(s + pad)


def load_rsa(keydir: Path):
    data = json.loads((keydir / '1').read_text())
    n = int.from_bytes(b64ws_decode(data['publicKey']['modulus']), 'big')
    e = int.from_bytes(b64ws_decode(data['publicKey']['publicExponent']), 'big')
    d = int.from_bytes(b64ws_decode(data['privateExponent']), 'big')
    p = int.from_bytes(b64ws_decode(data['primeP']), 'big')
    q = int.from_bytes(b64ws_decode(data['primeQ']), 'big')
    dp = int.from_bytes(b64ws_decode(data['primeExponentP']), 'big')
    dq = int.from_bytes(b64ws_decode(data['primeExponentQ']), 'big')
    qi = int.from_bytes(b64ws_decode(data['crtCoefficient']), 'big')
    key = rsa.RSAPrivateNumbers(p, q, d, dp, dq, qi, rsa.RSAPublicNumbers(e, n)).private_key(default_backend())
    padname = data['publicKey'].get('padding', 'OAEP')
    return key, padname


def keyczar_decrypt(ciphertext_b64: str, keydir: Path) -> str:
    raw = b64ws_decode(ciphertext_b64)
    if raw[0] != 0:
        raise ValueError(f'bad keyczar version: {raw[0]}')
    body = raw[5:]
    key, padname = load_rsa(keydir)
    klen = key.key_size // 8
    pad = (
        padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA1()), algorithm=hashes.SHA1(), label=None)
        if padname.upper() == 'OAEP'
        else padding.PKCS1v15()
    )
    out = bytearray()
    for i in range(0, len(body), klen):
        block = body[i:i + klen]
        if len(block) < klen:
            break
        out += key.decrypt(block, pad)
    return out.decode('utf-8', errors='replace')


def decrypt_properties(path: Path, keydir: Path) -> dict:
    result = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        result[key] = keyczar_decrypt(value, keydir)
    return result


def main():
    apk_keys = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('/tmp/tvphones_raw/assets/4096k')
    for name in ('init-encript.properties', 'application-encript.properties'):
        url = f'https://raw.githubusercontent.com/bankaiplayer/data/main/tv/{name}'
        out = Path(f'/tmp/mxl_{name}')
        if not out.exists():
            import urllib.request
            out.write_bytes(urllib.request.urlopen(url, timeout=20).read())
        props = decrypt_properties(out, apk_keys)
        print(f'=== {name} ===')
        for k, v in props.items():
            print(f'{k}={v[:200]}' if len(v) > 200 else f'{k}={v}')


if __name__ == '__main__':
    main()
