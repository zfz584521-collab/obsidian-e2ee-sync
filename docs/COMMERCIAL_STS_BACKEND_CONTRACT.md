# 商业模式 STS 后端接口契约

本文档定义插件商业模式第一版需要的后端能力。目标是可落地、可执行、架构简单，并且不把永久 AccessKey 发给用户。

## 一、第一版范围

第一版后端只做一件事：

```text
验证用户授权令牌 -> 判断用户是否可用 -> 签发短期 OSS STS 凭证 -> 返回用户专属同步路径
```

暂不要求第一版同时完成：

```text
复杂账号系统
支付系统
管理后台
自动开票
团队空间
网页端文件管理
```

这些可以在 STS 签发链路跑通后逐步加。

## 二、插件请求

```http
POST /api/sync/credentials
Authorization: Bearer <用户授权令牌>
Content-Type: application/json
```

请求体：

```json
{
  "vaultId": "main",
  "repoId": "repo_xxx",
  "deviceId": "dev_xxx",
  "pluginVersion": "0.1.0"
}
```

字段说明：

| 字段 | 是否必填 | 说明 |
|---|---|---|
| `vaultId` | 是 | 商业侧仓库名。第一版默认 `main` 即可。 |
| `repoId` | 否 | 插件现有仓库 ID。后端可返回自己的 repoId 覆盖。 |
| `deviceId` | 是 | 插件设备 ID。后端只用于设备数量限制和审计，不要写进用户可见日志。 |
| `pluginVersion` | 是 | 插件版本，用于兼容性控制。 |

## 三、后端响应

成功响应：

```json
{
  "endpoint": "https://s3.oss-cn-hangzhou.aliyuncs.com",
  "bucket": "obsidian-sync-commercial",
  "region": "cn-hangzhou",
  "storagePrefix": "tenants/u_10001/vaults/main",
  "repoId": "repo_u_10001_main",
  "credentials": {
    "accessKeyId": "STS.xxx",
    "accessKeySecret": "temporary-secret",
    "securityToken": "temporary-token",
    "expiration": "2026-07-11T10:00:00Z"
  }
}
```

注意：

```text
上面是字段示例，不要把真实 AccessKey、Secret、SecurityToken 写进代码或文档。
```

错误响应建议：

```json
{
  "message": "授权令牌无效或已过期"
}
```

常见状态码：

| 状态码 | 场景 |
|---|---|
| `400` | 请求体缺字段或格式错误 |
| `401` | 授权令牌无效 |
| `403` | 用户停用、退订、设备超限 |
| `409` | 仓库状态冲突，需要用户处理 |
| `429` | 请求过于频繁 |
| `500` | 后端或云服务异常 |

## 四、OSS 路径隔离

推荐一个 bucket，多用户用前缀隔离：

```text
bucket: obsidian-sync-commercial
storagePrefix: tenants/{userId}/vaults/{vaultId}
```

插件最终写入的对象会在：

```text
tenants/{userId}/vaults/{vaultId}/repos/{repoId}/content/...
tenants/{userId}/vaults/{vaultId}/repos/{repoId}/logs/...
tenants/{userId}/vaults/{vaultId}/repos/{repoId}/meta/repo.json
```

后端签发 STS 时必须把权限限制在：

```text
oss://obsidian-sync-commercial/tenants/{userId}/vaults/{vaultId}/repos/{repoId}/*
```

不要给临时凭证整个 bucket 的权限。

仓库内提供了最小权限策略生成辅助脚本：

```powershell
$env:OSS_BUCKET="obsidian-sync-commercial"
$env:OSS_PREFIX="tenants/u_10001/vaults/main/repos/repo_main"
npm.cmd run policy:oss-sts
```

这个脚本只生成策略 JSON，不会读取任何云账号信息，也不会访问阿里云。

## 五、第一版数据表

可以先用很少的表：

```text
users
user_tokens
devices
vaults
credential_audit_logs
```

最小字段建议：

```text
users: id, status, plan, created_at
user_tokens: token_hash, user_id, status, expires_at
devices: user_id, device_id_hash, first_seen_at, last_seen_at
vaults: user_id, vault_id, repo_id, storage_prefix, created_at
credential_audit_logs: user_id, vault_id, device_id_hash, result, created_at
```

安全建议：

```text
授权令牌只存 hash，不存明文。
deviceId 存 hash 或脱敏值。
日志不记录 AccessKeySecret、SecurityToken、同步密码。
```

## 六、凭证有效期

建议第一版：

```text
STS 有效期：1 小时
插件提前刷新：5 分钟
```

后端返回的 `expiration` 必须是 ISO 8601 时间。

插件已经会拒绝使用“已过期或即将过期”的临时凭证。

## 七、后端环境变量建议

真实后端建议使用环境变量，不要把密钥写进源码：

```text
ALIYUN_REGION=cn-hangzhou
ALIYUN_STS_ROLE_ARN=acs:ram::1234567890123456:role/xxx
ALIYUN_ACCESS_KEY_ID=...
ALIYUN_ACCESS_KEY_SECRET=...
OSS_BUCKET=obsidian-sync-commercial
OSS_ENDPOINT=https://s3.oss-cn-hangzhou.aliyuncs.com
STS_DURATION_SECONDS=3600
```

阿里云官方约束：

```text
DurationSeconds 最小 900 秒。
AssumeRole 返回 AccessKeyId、AccessKeySecret、SecurityToken、Expiration。
服务端调用方必须是 RAM 用户或 RAM 角色，不能使用主账号直接调用。
调用方需要具备 sts:AssumeRole 权限，目标 Role 也需要信任该调用方。
```

部署平台可以是：

```text
一台轻量服务器 + Node 服务
Docker
Serverless 函数
```

第一版推荐轻量服务器或容器，排查问题更直接。

## 八、本地 mock 服务

仓库内提供一个本地 mock：

```powershell
npm.cmd run mock:sts
```

默认地址：

```text
http://127.0.0.1:8787
```

默认授权令牌：

```text
dev-commercial-token
```

这个 mock 只返回假凭证结构，用于验证插件请求、UI、错误提示和刷新逻辑，不会连接阿里云。

仓库还提供了商业后端核心规则骨架：

```text
scripts/commercial-sts-core.mjs
scripts/commercial-sts-server.mjs
```

覆盖：

```text
token hash
用户状态校验
设备数量限制
storagePrefix/repoId 生成
审计日志脱敏
```

启动可部署服务骨架：

```powershell
$env:OSS_BUCKET="obsidian-sync-commercial"
$env:SEED_AUTH_TOKEN="dev-commercial-token"
npm.cmd run server:commercial-sts
```

默认地址：

```text
http://127.0.0.1:8788
```

注意：

```text
默认 STS_PROVIDER=mock，只返回假临时凭证，不能用于生产。
生产使用 STS_PROVIDER=aliyun。
Aliyun 模式必须配置非默认 TOKEN_SALT、DEVICE_SALT 和 SEED_AUTH_TOKEN，否则服务拒绝启动。
```

真实阿里云 provider：

```text
scripts/aliyun-sts-provider.mjs
```

启动真实 provider 所需环境变量：

```powershell
$env:STS_PROVIDER="aliyun"
$env:ALIYUN_ACCESS_KEY_ID="..."
$env:ALIYUN_ACCESS_KEY_SECRET="..."
$env:ALIYUN_STS_ROLE_ARN="acs:ram::1234567890123456:role/your-role"
$env:OSS_BUCKET="obsidian-sync-commercial"
npm.cmd run server:commercial-sts
```

说明：

```text
该 provider 使用阿里云 OpenAPI V3 签名调用 AssumeRole。
签名实现已用阿里云官方文档中的固定参数示例校准。
```

运营流程参考：

```text
docs/COMMERCIAL_STS_OPERATIONS_RUNBOOK.md
```

## 九、真实 STS 接入验收清单

真实后端完成后，需要验证：

```text
有效用户可以获取临时凭证
无效 token 返回 401
停用用户返回 403
设备超限返回 403
张三只能写 tenants/zhangsan/
李四只能写 tenants/lisi/
张三不能 list/get/delete 李四路径
临时凭证过期后插件能自动刷新
后端日志不含 token、secret、securityToken、同步密码、明文 deviceId
客户端传入的 repoId 不能通过通配符扩大 STS Policy 范围
超大请求体返回 413，不进入授权与签发流程
```

## 十、商业化第一版推荐流程

最小可运营流程：

```text
运营后台手工创建用户
为用户生成一个授权令牌
把授权服务地址和授权令牌发给用户
用户在插件中选择商业模式
用户填写授权服务地址、授权令牌、同步密码
插件自动同步
用户停用时，后端禁用 token，不再签发 STS
```

这条路线足够简单，可以先服务早期付费用户；等真实需求稳定后，再补登录、支付、设备管理和管理后台。
