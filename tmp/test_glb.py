import urllib.request
import json
import struct

def inspect_glb(url, name):
    print(f"Downloading {name}...")
    try:
        data = urllib.request.urlopen(url).read()
        # Parse GLB header
        magic, version, length = struct.unpack("<III", data[:12])
        if magic != 0x46546C67:
            print("Not a valid GLB")
            return
        # First chunk is JSON
        chunk_length, chunk_type = struct.unpack("<II", data[12:20])
        if chunk_type != 0x4E4F534A:
            print("First chunk is not JSON")
            return
        json_data = data[20:20+chunk_length].decode("utf-8")
        gltf = json.loads(json_data)
        nodes = gltf.get("nodes", [])
        names = [n.get("name") for n in nodes if n.get("name")]
        print(f"Node names in {name}:")
        for n in sorted(names):
            if "muzzle" in n.lower() or "barrel" in n.lower() or "gun" in n.lower() or "rifle" in n.lower() or "rotate" in n.lower():
                print(f"  - {n}")
    except Exception as e:
        print("Error:", e)

inspect_glb("https://github.com/Singulary-tee/vexea/releases/download/Asset/wheeled_drone.glb", "wheeled_drone.glb")
inspect_glb("https://github.com/Singulary-tee/vexea/releases/download/Asset/quadcopter_rifle.glb", "quadcopter_rifle.glb")
