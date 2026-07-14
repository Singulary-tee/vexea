import urllib.request
import json
import struct

def inspect_glb(url, name):
    print(f"Downloading {name}...")
    try:
        data = urllib.request.urlopen(url).read()
        magic, version, length = struct.unpack("<III", data[:12])
        if magic != 0x46546C67:
            print("Not a valid GLB")
            return
        chunk_length, chunk_type = struct.unpack("<II", data[12:20])
        json_data = data[20:20+chunk_length].decode("utf-8", errors="ignore")
        gltf = json.loads(json_data)
        nodes = gltf.get("nodes", [])
        names = [n.get("name") for n in nodes if n.get("name")]
        print(f"All node names in {name}:", sorted(names))
    except Exception as e:
        print("Error:", e)

inspect_glb("https://github.com/Singulary-tee/vexea/releases/download/Asset/wheeled_drone.glb", "wheeled_drone.glb")
inspect_glb("https://github.com/Singulary-tee/vexea/releases/download/Asset/quadcopter_rifle.glb", "quadcopter_rifle.glb")
