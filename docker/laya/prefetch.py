"""Build-time step: start laya-serve once so it downloads its model into the image, then stop it.

A deployed container then needs no volume and no access to Hugging Face when it starts.
"""
import json
import subprocess
import sys
import time
import urllib.request

server = subprocess.Popen(["laya-serve"])
deadline = time.time() + 900
loaded = []
while time.time() < deadline and not loaded and server.poll() is None:
    try:
        with urllib.request.urlopen("http://127.0.0.1:8000/health", timeout=5) as response:
            loaded = json.load(response).get("loaded", [])
    except OSError:
        pass
    if not loaded:
        time.sleep(3)
server.terminate()
server.wait(timeout=30)
print("preloaded checkpoints:", loaded)
sys.exit(0 if loaded else 1)
