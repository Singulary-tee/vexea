import urllib.request, json, struct

data = urllib.request.urlopen("https://github.com/Singulary-tee/vexea/releases/download/Asset/wheeled_drone.glb").read()
chunk_length, chunk_type = struct.unpack("<II", data[12:20])
gltf = json.loads(data[20:20+chunk_length].decode("utf-8"))

nodes = gltf.get("nodes", [])

def print_node(node_idx, depth):
    node = nodes[node_idx]
    name = node.get("name", f"Node_{node_idx}")
    print("  " * depth + name)
    for child_idx in node.get("children", []):
        print_node(child_idx, depth + 1)

for scene in gltf.get("scenes", []):
    for node_idx in scene.get("nodes", []):
        print_node(node_idx, 0)
