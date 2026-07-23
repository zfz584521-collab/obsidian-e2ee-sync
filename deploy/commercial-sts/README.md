# 商业 STS 单机部署

该部署由两个容器组成：

- `backend`：签发阿里云 STS 临时凭证，仅在 Docker 内部网络监听。
- `caddy`：对外开放 80/443，自动申请和续期 HTTPS 证书。

用户、令牌哈希、设备哈希和脱敏审计记录保存在 Docker 持久卷中。第一版不需要额外数据库。

## 一、服务器准备

准备一台安装了 Docker Engine 与 Docker Compose v2 的 Linux 服务器，并完成：

1. 将授权服务域名的 DNS `A` 记录指向服务器公网 IP。
2. 在云防火墙或安全组中开放 TCP 80、TCP 443 和 UDP 443。
3. 不直接开放后端端口 8788。

## 二、生产配置

在本目录执行：

```bash
cp .env.example .env
chmod 600 .env
```

生成两个不同的随机盐：

```bash
openssl rand -hex 32
openssl rand -hex 32
```

编辑 `.env`，填写域名、专用 RAM 用户凭证、Role ARN、商业 Bucket，以及两个不同的随机盐。不要把 `.env` 提交到 Git。

## 三、启动和检查

```bash
docker compose up -d --build
docker compose ps
curl --fail https://你的授权域名/healthz
curl --fail https://你的授权域名/readyz
```

健康检查只返回：

```json
{"status":"ok"}
```

就绪检查返回 provider、存储类型和脱敏计数，不包含 bucket、endpoint、授权令牌或设备明文：

```json
{
  "status": "ready",
  "provider": "aliyun",
  "store": "persistent",
  "counts": {
    "users": 1,
    "tokens": 1,
    "devices": 0,
    "auditLogs": 0
  }
}
```

## 四、创建首位用户

查看运营 CLI 支持的命令：

```bash
docker compose exec backend node scripts/commercial-sts-admin.mjs help
```

创建最多使用三台设备的用户：

```bash
docker compose exec backend node scripts/commercial-sts-admin.mjs create-user customer_001 3
```

签发令牌。令牌不会显示在终端，只写入容器内的 `.secret` 文件：

```bash
docker compose exec \
  -e TOKEN_OUTPUT_FILE=/app/data/issued-customer_001.secret \
  backend node scripts/commercial-sts-admin.mjs issue-token customer_001
docker compose cp backend:/app/data/issued-customer_001.secret ./issued-customer_001.secret
chmod 600 ./issued-customer_001.secret
docker compose exec backend rm -f /app/data/issued-customer_001.secret
```

签发 30 天有效令牌时，在用户 ID 后追加天数：

```bash
docker compose exec \
  -e TOKEN_OUTPUT_FILE=/app/data/issued-customer_001.secret \
  backend node scripts/commercial-sts-admin.mjs issue-token customer_001 30
```

通过安全渠道把 `issued-customer_001.secret` 中的令牌交给用户，随后删除本地临时文件。

## 五、用户生命周期

查看状态：

```bash
docker compose exec backend node scripts/commercial-sts-admin.mjs user-status customer_001
```

查看用户清单、状态、套餐和设备占用：

```bash
docker compose exec backend node scripts/commercial-sts-admin.mjs list-users
docker compose exec backend node scripts/commercial-sts-admin.mjs list-users 200
```

排查单个用户问题时生成脱敏客服报告：

```bash
docker compose exec backend node scripts/commercial-sts-admin.mjs support-report customer_001
docker compose exec backend node scripts/commercial-sts-admin.mjs support-report customer_001 60
```

升级、降级或调整设备额度：

```bash
docker compose exec backend node scripts/commercial-sts-admin.mjs update-user customer_001 pro 5
```

停用或恢复用户：

```bash
docker compose exec backend node scripts/commercial-sts-admin.mjs disable-user customer_001
docker compose exec backend node scripts/commercial-sts-admin.mjs enable-user customer_001
```

查看或移除用户设备：

```bash
docker compose exec backend node scripts/commercial-sts-admin.mjs list-devices customer_001
read -s DEVICE_ID_TO_FORGET
export DEVICE_ID_TO_FORGET
docker compose exec -e DEVICE_ID_TO_FORGET backend \
  node scripts/commercial-sts-admin.mjs forget-device customer_001
unset DEVICE_ID_TO_FORGET
```

吊销单个令牌时，不要把令牌直接写进命令历史：

```bash
read -s AUTH_TOKEN_TO_REVOKE
export AUTH_TOKEN_TO_REVOKE
docker compose exec -e AUTH_TOKEN_TO_REVOKE backend \
  node scripts/commercial-sts-admin.mjs revoke-token
unset AUTH_TOKEN_TO_REVOKE
```

如果没有明文令牌，可以先列出用户令牌哈希，再按哈希吊销：

```bash
docker compose exec backend node scripts/commercial-sts-admin.mjs list-tokens customer_001
read -s TOKEN_HASH_TO_REVOKE
export TOKEN_HASH_TO_REVOKE
docker compose exec -e TOKEN_HASH_TO_REVOKE backend \
  node scripts/commercial-sts-admin.mjs revoke-token-hash
unset TOKEN_HASH_TO_REVOKE
```

用户续费或延长试用时，可以按 token hash 延长有效期，用户无需更换插件里的授权令牌：

```bash
docker compose exec backend node scripts/commercial-sts-admin.mjs renewal-report
docker compose exec backend node scripts/commercial-sts-admin.mjs renewal-report 30 200
docker compose exec backend node scripts/commercial-sts-admin.mjs list-tokens customer_001
read -s TOKEN_HASH_TO_EXTEND
export TOKEN_HASH_TO_EXTEND
docker compose exec -e TOKEN_HASH_TO_EXTEND backend \
  node scripts/commercial-sts-admin.mjs extend-token-hash 30
unset TOKEN_HASH_TO_EXTEND
```

查看最近脱敏审计记录：

```bash
docker compose exec backend node scripts/commercial-sts-admin.mjs audit-log
docker compose exec backend node scripts/commercial-sts-admin.mjs audit-log customer_001 50
```

查看最近 60 分钟的脱敏审计汇总，用于人工巡检或外部告警脚本：

```bash
docker compose exec backend node scripts/commercial-sts-admin.mjs audit-summary
docker compose exec backend node scripts/commercial-sts-admin.mjs audit-summary customer_001 60
```

审计汇总只输出 `total`、`byResult` 和 `byStatus` 聚合计数。

审计查询结果只包含脱敏哈希、状态码和统计字段，不会输出明文授权令牌或设备 ID。

## 六、备份和恢复

备份文件包含用户和令牌哈希，仍应作为敏感数据保存：

```bash
docker compose exec backend node scripts/commercial-sts-admin.mjs verify-store
mkdir -p backup
docker compose cp backend:/app/data/store.json ./backup/store.json
chmod 600 ./backup/store.json
```

恢复前先停止后端，复制完成后再启动：

```bash
docker compose stop backend
docker compose cp ./backup/store.json backend:/app/data/store.json
docker compose start backend
curl --fail https://你的授权域名/healthz
docker compose exec backend node scripts/commercial-sts-admin.mjs verify-store
```

## 七、更新

```bash
docker compose build --pull backend
docker compose up -d
docker compose ps
```

更新前先备份 `store.json`。部署后执行健康检查，并用测试用户验证一次凭证获取。
