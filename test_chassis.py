import urllib.request, json, struct
data = urllib.request.urlopen('https://github.com/Singulary-tee/vexea/releases/download/Asset/wheeled_drone.glb').read()
chunk_length, chunk_type = struct.unpack('<II', data[12:20])
gltf = json.loads(data[20:20+chunk_length].decode('utf-8'))
for n in gltf.get('nodes', []):
    name = n.get('name', 'unnamed')
    print(name, 'mesh' in n)
