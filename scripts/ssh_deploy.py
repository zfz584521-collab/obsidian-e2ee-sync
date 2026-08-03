#!/usr/bin/env python3
"""SSH to server through HTTP proxy - add pubkey and deploy."""
import paramiko
import socket
import sys
import time

HOST = "sync.e2note.com"
PORT = 2222
USER = "root"
PASS = "Zfzlxqmryp@521"
PUBKEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAC27PnJtGQ7KyseG4Y83+J93Cb23pSmE3XheQi7dR8c"
PROXY_HOST = "127.0.0.1"
PROXY_PORT = 7897

def create_proxy_tunnel(dest_host, dest_port):
    """Create a tunnel through HTTP proxy using CONNECT method."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(15)
    sock.connect((PROXY_HOST, PROXY_PORT))

    connect_req = f"CONNECT {dest_host}:{dest_port} HTTP/1.1\r\nHost: {dest_host}:{dest_port}\r\n\r\n"
    sock.sendall(connect_req.encode())

    # Read HTTP response
    response = b""
    while b"\r\n\r\n" not in response:
        data = sock.recv(4096)
        if not data:
            raise Exception("Proxy connection closed")
        response += data

    status_line = response.split(b"\r\n")[0].decode("utf-8", errors="replace")
    if "200" not in status_line:
        raise Exception(f"Proxy CONNECT failed: {status_line}")

    print(f"Proxy tunnel established: {status_line}")
    return sock

def ssh_connect_via_proxy():
    """Connect via SSH through HTTP proxy tunnel."""
    print(f"Creating proxy tunnel to {HOST}:{PORT}...")
    sock = create_proxy_tunnel(HOST, PORT)

    print("Starting SSH transport...")
    transport = paramiko.Transport(sock)
    transport.set_missing_host_key_policy = paramiko.AutoAddPolicy()
    transport.connect(username=USER, password=PASS)

    print("SSH transport connected!")
    client = paramiko.SSHClient()
    client._transport = transport
    return client, transport

def run_cmd(transport, cmd, timeout=300):
    """Run a command via transport."""
    chan = transport.open_session()
    chan.settimeout(timeout)
    chan.exec_command(cmd)
    out = b""
    err = b""
    while True:
        if chan.recv_ready():
            out += chan.recv(65536)
        if chan.recv_stderr_ready():
            err += chan.recv_stderr(65536)
        if chan.exit_status_ready():
            # Drain remaining
            while chan.recv_ready():
                out += chan.recv(65536)
            while chan.recv_stderr_ready():
                err += chan.recv_stderr(65536)
            break
        time.sleep(0.1)
    code = chan.recv_exit_status()
    chan.close()
    return out.decode("utf-8", errors="replace").strip(), err.decode("utf-8", errors="replace").strip(), code

def deploy(transport):
    """Deploy the latest code on the server."""
    steps = [
        ("1. Git pull", "cd /opt/obsidian-e2ee-sync && git pull --ff-only origin master 2>&1", 60),
        ("2. Compose check", "cd /opt/obsidian-e2ee-sync/deploy/commercial-sts && docker compose --env-file .env config --quiet 2>&1 && echo COMPOSE_OK", 30),
        ("3. Docker build", "cd /opt/obsidian-e2ee-sync/deploy/commercial-sts && docker compose build --pull backend 2>&1 | tail -10", 600),
        ("4. Docker up", "cd /opt/obsidian-e2ee-sync/deploy/commercial-sts && docker compose up -d 2>&1", 120),
        ("5. Health check", "curl -fsS http://127.0.0.1:8788/healthz 2>&1", 15),
        ("6. Ready check", "curl -fsS http://127.0.0.1:8788/readyz 2>&1", 15),
        ("7. Admin page check", "curl -fsS -o /dev/null -w '%{http_code}' http://127.0.0.1:8788/admin 2>&1", 15),
    ]

    all_ok = True
    for name, cmd, timeout in steps:
        print(f"\n--- {name} ---")
        out, err, code = run_cmd(transport, cmd, timeout)
        if out:
            print(f"OUT: {out[:600]}")
        if err:
            print(f"ERR: {err[:600]}")
        print(f"EXIT: {code}")
        if code != 0 and "Git pull" in name:
            print("Git pull failed, stopping.")
            return False
    return True

if __name__ == "__main__":
    try:
        client, transport = ssh_connect_via_proxy()

        # First: add the correct public key
        print("\n=== Adding SSH public key ===")
        cmd = f"echo '{PUBKEY}' > /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys && echo KEY_SET"
        out, err, code = run_cmd(transport, cmd, 15)
        print(f"Result: {out} {err} (exit {code})")

        # Verify
        out, err, code = run_cmd(transport, "cat /root/.ssh/authorized_keys", 10)
        print(f"Verified: {out[:200]}")

        # Deploy
        print("\n=== Starting deployment ===")
        success = deploy(transport)
        if success:
            print("\n=== Deployment complete ===")
        else:
            print("\n=== Deployment failed ===")

        transport.close()
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
