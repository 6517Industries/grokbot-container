"""Apply the browser transport to a vendor ASAR without changing its backend bundles."""
import copy
import hashlib
import json
import pathlib
import struct
import sys

archive, output = map(pathlib.Path, sys.argv[1:3])
raw = archive.read_bytes()
_, header_size, _, json_size = struct.unpack('<4I', raw[:16])
header = json.loads(raw[16:16 + json_size])
body = bytearray(raw[8 + header_size:])

def entry(name, create=False):
    node = header
    for part in name.split('/'):
        if create:
            node = node.setdefault('files', {}).setdefault(part, {})
        else:
            node = node['files'][part]
    return node

def read(name):
    node = entry(name)
    assert not node.get('unpacked')
    start = int(node['offset'])
    return bytes(body[start:start + node['size']])

def write(name, data):
    node = entry(name, True)
    node.clear()
    block = 4 * 1024 * 1024
    node.update(size=len(data), offset=str(len(body)), integrity={
        'algorithm': 'SHA256', 'hash': hashlib.sha256(data).hexdigest(),
        'blockSize': block,
        'blocks': [hashlib.sha256(data[i:i+block]).hexdigest() for i in range(0,len(data),block)],
    })
    body.extend(data)

package = json.loads(read('package.json'))
main = package['main']
preload = 'dist/electron-preload/preload.cjs'
renderer = 'dist/renderer/index.html'
assert b'sand:boot-snapshot-sync' in read(preload)
assert b'coordinatorPort' in read(preload)
assert b'<head>' in read(renderer)
write(main, b'require("/opt/grok-web/host.cjs");\n' + read(main))
write('dist/electron-preload/vendor-preload.cjs', read(preload))
relay = pathlib.Path('/opt/grok-web/relay.cjs').read_bytes()
coordinator = pathlib.Path('/opt/grok-web/coordinator.cjs').read_bytes()
# Electron's sandboxed preload cannot require arbitrary local modules.
relay = relay.replace(b"require('/opt/grok-web/coordinator.cjs')", b'(function(){const module={exports:{}};\n' + coordinator + b'\nreturn module.exports;})()')
write(preload, relay + b'\n' + read(preload))
write('dist/renderer/web-index.html', read(renderer))
write(renderer, b'<!doctype html><title>Grok Bot service host</title>')
encoded = json.dumps(header,separators=(',',':')).encode()
padded = (len(encoded)+3)//4*4
output.write_bytes(struct.pack('<4I',4,padded+8,padded+4,len(encoded))+encoded+b'\0'*(padded-len(encoded))+body)
print(f'Prepared Grok Bot {package["version"]}: {output}')
