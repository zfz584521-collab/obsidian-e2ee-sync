#!/usr/bin/env python3
"""Alibaba Cloud ECS API helper - list instances and run commands via Cloud Assistant."""
import urllib.request
import urllib.parse
import hmac
import hashlib
import base64
import time
import json
import sys
import uuid

ACCESS_KEY_ID = sys.argv[1] if len(sys.argv) > 1 else ""
ACCESS_KEY_SECRET = sys.argv[2] if len(sys.argv) > 2 else ""
REGION = "cn-hongkong"
ENDPOINT = f"ecs.{REGION}.aliyuncs.com"
API_VERSION = "2014-05-26"

def percent_encode(s: str) -> str:
    return urllib.parse.quote(s, safe="~-_.!~*'()")

def sign(params: dict, secret: str) -> str:
    sorted_items = sorted(params.items())
    canonical = "&".join(f"{percent_encode(k)}={percent_encode(v)}" for k, v in sorted_items)
    string_to_sign = "GET&" + percent_encode("/") + "&" + percent_encode(canonical)
    key = (secret + "&").encode("utf-8")
    msg = string_to_sign.encode("utf-8")
    digest = hmac.new(key, msg, hashlib.sha1).digest()
    return base64.b64encode(digest).decode("utf-8")

def call_api(action: str, extra_params: dict = None) -> dict:
    params = {
        "Action": action,
        "Version": API_VERSION,
        "Format": "JSON",
        "AccessKeyId": ACCESS_KEY_ID,
        "SignatureMethod": "HMAC-SHA1",
        "SignatureVersion": "1.0",
        "SignatureNonce": str(uuid.uuid4()),
        "Timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "RegionId": REGION,
    }
    if extra_params:
        params.update(extra_params)

    sig = sign(params, ACCESS_KEY_SECRET)
    params["Signature"] = sig

    query = urllib.parse.urlencode(params)
    url = f"https://{ENDPOINT}/?{query}"

    req = urllib.request.Request(url)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        return {"error": f"HTTP {e.code}", "body": body}
    except Exception as e:
        return {"error": str(e)}

def list_instances():
    return call_api("DescribeInstances", {
        "PageSize": "50",
        "PageNumber": "1",
    })

def run_command(instance_id: str, script: str, timeout: int = 300):
    encoded_script = base64.b64encode(script.encode("utf-8")).decode("utf-8")
    return call_api("RunCommand", {
        "InstanceIds": json.dumps([instance_id]),
        "CommandContent": encoded_script,
        "Type": "RunShellScript",
        "Timeout": str(timeout),
    })

def get_invocation_result(instance_id: str, invoke_id: str):
    return call_api("DescribeInvocationResults", {
        "InstanceIds": json.dumps([instance_id]),
        "InvokeId": invoke_id,
    })

if __name__ == "__main__":
    if not ACCESS_KEY_ID or not ACCESS_KEY_SECRET:
        print("Usage: python aliyun_api.py <AK> <SK> [action] [args...]")
        sys.exit(1)

    action = sys.argv[3] if len(sys.argv) > 3 else "list"

    if action == "list":
        result = list_instances()
        if "error" in result:
            print(f"ERROR: {result['error']}")
            if "body" in result:
                print(result["body"][:500])
        else:
            instances = result.get("Instances", {}).get("Instance", [])
            for inst in instances:
                iid = inst.get("InstanceId", "?")
                name = inst.get("InstanceName", "?")
                ips = inst.get("PublicIpAddress", {}).get("IpAddress", [])
                eips = inst.get("EipAddress", {})
                pub_ip = ips[0] if ips else (eips.get("IpAddress", "?") if eips else "?")
                status = inst.get("Status", "?")
                print(f"ID={iid} Name={name} IP={pub_ip} Status={status}")
            if not instances:
                print(f"No instances found. Raw: {json.dumps(result, indent=2)[:500]}")
    elif action == "run":
        script = sys.stdin.read()
        instance_id = sys.argv[4] if len(sys.argv) > 4 else ""
        if not instance_id:
            print("Need instance_id as 4th arg")
            sys.exit(1)
        result = run_command(instance_id, script)
        print(json.dumps(result, indent=2)[:500])
    elif action == "result":
        instance_id = sys.argv[4]
        invoke_id = sys.argv[5]
        result = get_invocation_result(instance_id, invoke_id)
        print(json.dumps(result, indent=2)[:1000])
