"""Print the sha256 of index.html's inline start-up script, for its Content-Security-Policy,
and whether the policy already has it. Run after changing that script: python3 tools/csp_hash.py"""
import base64
import hashlib
import re
from pathlib import Path

html = (Path(__file__).resolve().parent.parent / "index.html").read_text()
script = re.search(r"<script>(.*?)</script>", html, re.S).group(1)
digest = "sha256-" + base64.b64encode(hashlib.sha256(script.encode()).digest()).decode()
print(digest, "(in the policy)" if digest in html else "(NOT in the policy: update index.html)")
