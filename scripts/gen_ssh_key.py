#!/usr/bin/env python3
"""Generate SSH key pair for server deployment."""
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from cryptography.hazmat.primitives import serialization
import os

key = Ed25519PrivateKey.generate()
priv = key.private_bytes(
    serialization.Encoding.PEM,
    serialization.PrivateFormat.OpenSSH,
    serialization.NoEncryption()
)
pub = key.public_key().public_bytes(
    serialization.Encoding.OpenSSH,
    serialization.PublicFormat.OpenSSH
)

path = os.path.expanduser("~/.ssh/id_ed25519_obsidian_sync")
with open(path, 'wb') as f:
    f.write(priv)
os.chmod(path, 0o600)
with open(path + '.pub', 'wb') as f:
    f.write(pub + b'\n')
print("KEYGEN_OK")
print(pub.decode())
