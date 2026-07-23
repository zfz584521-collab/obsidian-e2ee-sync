# 商业 STS 第一版运营手册

本文档描述商业模式第一版如何运营。目标是先用最小系统服务早期用户，再逐步演进到完整 SaaS。

## 一、第一版运营原则

```text
不把永久 AccessKey 发给用户。
用户只拿授权服务地址和授权令牌。
同步密码由用户自己设置，服务端不保存。
每个用户限制在自己的 OSS 前缀内。
停用用户时，后端停止签发 STS。
```

## 二、开通一个用户

第一版可以由运营人员手工开通：

查看运营 CLI 支持的命令：

```powershell
npm.cmd run admin:commercial-sts -- help
```

```text
1. 创建 userId，例如 u_10001。
2. 创建授权令牌，只展示一次给用户。
3. 后端只保存 token hash，不保存明文 token。
4. 创建默认 vaultId：main。
5. 生成 storagePrefix：tenants/u_10001/vaults/main。
6. 生成 repoId：repo_u_10001_main。
7. 告诉用户授权服务地址和授权令牌。
```

签发令牌时可以设置有效天数，适合试用或固定期限用户：

```powershell
npm.cmd run admin:commercial-sts -- issue-token u_10001 30
```

不传有效天数时令牌长期有效，后续仍可通过 `revoke-token` 吊销。有效天数允许 1 到 366 天。

查看用户令牌哈希和状态：

```powershell
npm.cmd run admin:commercial-sts -- list-tokens u_10001
```

查看已经过期或 30 天内即将到期的 active token，用于续费提醒：

```powershell
npm.cmd run admin:commercial-sts -- renewal-report
npm.cmd run admin:commercial-sts -- renewal-report 30 200
```

续费报表不输出明文授权令牌，只输出 `tokenHash`、`userId`、过期时间和剩余天数，便于后续使用 `extend-token-hash` 续期。

查看用户清单、状态、套餐和设备占用：

```powershell
npm.cmd run admin:commercial-sts -- list-users
npm.cmd run admin:commercial-sts -- list-users 200
```

用户清单不输出授权令牌、令牌哈希、设备 ID 或设备哈希。

排查单个用户问题时，生成脱敏客服报告：

```powershell
npm.cmd run admin:commercial-sts -- support-report u_10001
npm.cmd run admin:commercial-sts -- support-report u_10001 60
```

客服报告只包含用户状态、套餐、设备占用、令牌数量分类和审计汇总，不输出授权令牌、令牌哈希、设备 ID 或设备哈希。

用户从试用升级、降级或调整设备额度时，更新套餐和最大设备数：

```powershell
npm.cmd run admin:commercial-sts -- update-user u_10001 pro 5
```

`plan` 只允许字母、数字、下划线和连字符；`maxDevices` 允许 1 到 20。

如果已经没有明文令牌，但能从 `list-tokens` 或审计记录定位到 token hash，可以按哈希吊销：

```powershell
$env:TOKEN_HASH_TO_REVOKE="要吊销的 token hash"
npm.cmd run admin:commercial-sts -- revoke-token-hash
Remove-Item Env:\TOKEN_HASH_TO_REVOKE
```

用户续费或延长试用时，可以按 token hash 延长有效期，用户无需更换插件里的授权令牌：

```powershell
$env:TOKEN_HASH_TO_EXTEND="要续期的 token hash"
npm.cmd run admin:commercial-sts -- extend-token-hash 30
Remove-Item Env:\TOKEN_HASH_TO_EXTEND
```

续期会把该 token 状态恢复为 `active`，并把过期时间设置为从当前时间起指定天数后。有效天数允许 1 到 366。

用户在插件里填写：

```text
使用模式：商业模式：授权服务
授权服务地址：https://你的域名
授权令牌：运营发给用户的令牌
同步密码：用户自己设置
```

不要让用户填写：

```text
AccessKey ID
AccessKey Secret
SecurityToken
bucket
storagePrefix
repoId
```

## 三、停用一个用户

用户退订、退款、风控或测试结束时：

```text
1. 把 user.status 改成 disabled，或把 token.status 改成 disabled。
2. 后端立即拒绝新的 STS 签发请求。
3. 已签发的 STS 凭证会在短时间内自然过期。
4. 如有严重泄露风险，在阿里云侧撤销 role/session 或调整 RAM 权限。
```

插件侧表现：

```text
下一次同步或凭证刷新失败。
用户看到授权失败/用户不可用提示。
本地笔记不会被删除。
```

## 四、设备数量限制

第一版建议套餐：

```text
免费/试用：1 台设备
个人付费：3 台设备
高级用户：5 台设备
```

设备识别：

```text
插件发送 deviceId。
后端只保存 deviceId hash。
同一个 deviceId 重复请求不增加设备数。
超过上限返回 403。
```

查看某个用户已登记设备：

```powershell
npm.cmd run admin:commercial-sts -- list-devices u_10001
```

移除某台设备时，不要把明文设备 ID 写进命令历史，使用环境变量传入：

```powershell
$env:DEVICE_ID_TO_FORGET="用户设备 ID"
npm.cmd run admin:commercial-sts -- forget-device u_10001
Remove-Item Env:\DEVICE_ID_TO_FORGET
```

返回：

```json
{
  "message": "设备数量已达到当前套餐上限"
}
```

## 五、审计日志

建议记录：

```text
userId
vaultId
deviceIdHash
result
status
createdAt
```

不要记录：

```text
明文授权令牌
AccessKeySecret
SecurityToken
同步密码
明文 deviceId
笔记文件内容
明文文件路径
```

查看最近脱敏审计记录：

```powershell
npm.cmd run admin:commercial-sts -- audit-log
```

查看指定用户最近 50 条审计记录：

```powershell
npm.cmd run admin:commercial-sts -- audit-log u_10001 50
```

查看最近 60 分钟的脱敏审计汇总，用于人工巡检或外部告警脚本：

```powershell
npm.cmd run admin:commercial-sts -- audit-summary
npm.cmd run admin:commercial-sts -- audit-summary u_10001 60
```

审计汇总只输出 `total`、`byResult` 和 `byStatus` 聚合计数，不输出明文授权令牌、明文设备 ID、AccessKeySecret、SecurityToken 或同步密码。

审计查询结果只应包含 `deviceIdHash`、`authTokenHash`、状态码和结果，不应包含明文授权令牌、明文设备 ID、AccessKeySecret、SecurityToken 或同步密码。

备份或恢复 `store.json` 前后，可以做一次只读存储校验：

```powershell
npm.cmd run admin:commercial-sts -- verify-store
```

校验结果只输出持久化状态和用户、令牌、设备、审计日志计数；不会输出令牌哈希、设备哈希或任何明文敏感值。

## 六、最小后端模块

仓库中已有一个后端核心骨架：

```text
scripts/commercial-sts-core.mjs
scripts/commercial-sts-server.mjs
```

它包含：

```text
token hash
user/token/device 内存存储
设备数量限制
用户状态校验
storagePrefix/repoId 生成
审计日志脱敏
插件响应体生成
```

这个模块不连接阿里云。真实后端接入时，只需要把内存存储替换成数据库，把假凭证替换成阿里云 STS AssumeRole 返回值。

本地启动商业服务骨架：

```powershell
$env:OSS_BUCKET="obsidian-sync-commercial"
$env:SEED_AUTH_TOKEN="dev-commercial-token"
npm.cmd run server:commercial-sts
```

插件商业模式填写：

```text
授权服务地址：http://127.0.0.1:8788
授权令牌：dev-commercial-token
```

注意：

```text
这个服务默认仍然使用 mock STS provider，只适合验证商业授权流程。
真实上线必须接阿里云 AssumeRole。
```

真实阿里云 STS provider 已预留：

```text
scripts/aliyun-sts-provider.mjs
```

生产启动示例：

```powershell
$env:STS_PROVIDER="aliyun"
$env:ALIYUN_ACCESS_KEY_ID="..."
$env:ALIYUN_ACCESS_KEY_SECRET="..."
$env:ALIYUN_STS_ROLE_ARN="acs:ram::1234567890123456:role/your-role"
$env:OSS_BUCKET="obsidian-sync-commercial"
npm.cmd run server:commercial-sts
```

上线前必须确认：

```text
调用 AssumeRole 的是 RAM 用户或 RAM 角色，不是主账号。
调用方有 sts:AssumeRole 权限。
目标 RAM Role 信任该调用方。
DurationSeconds 不低于 900 秒。
Policy 限制到当前用户的 tenants/{userId}/vaults/{vaultId}/repos/{repoId}/*。
TOKEN_SALT 和 DEVICE_SALT 使用独立的生产随机值，不能沿用开发默认值。
Aliyun 模式必须配置持久化 STORE_PATH，或仅在首次初始化时提供种子授权令牌；使用开发默认盐时服务会拒绝启动。生产部署优先使用 STORE_PATH，再通过管理员 CLI 创建用户和签发令牌，避免长期保存明文种子令牌。
```

## 七、本地验证

启动 mock：

```powershell
npm.cmd run mock:sts
```

默认：

```text
授权服务地址：http://127.0.0.1:8787
授权令牌：dev-commercial-token
```

插件商业模式可以用这个地址和令牌测试：

```text
配置检查
请求授权服务
错误提示
凭证缓存与刷新
```

注意：

```text
mock 返回的是假 OSS 凭证，所以不能完成真实对象存储同步。
```

## 八、真实 STS 接入顺序

在发起任何真实阿里云请求前，先通过环境变量注入配置并运行安全预检：

```powershell
npm.cmd run preflight:commercial-sts
```

预检只输出是否就绪、STS 时长、HTTPS 检查结果、缺失的环境变量名称和固定告警，不输出 AccessKey、Secret、授权令牌、盐值、Role ARN、Bucket 名称或其他配置值。预检通过不代表云端权限已验证，只代表可以进入真实 AssumeRole 联调。

预检通过后，可以执行一次只签发凭证、不访问 OSS 对象的脱敏冒烟测试：

```powershell
npm.cmd run smoke:aliyun-sts
```

成功输出只包含 `success`、凭证字段是否齐全和过期时间；失败输出固定错误，不显示云端响应、AccessKey、Secret、SecurityToken、Role ARN、Bucket 或租户路径。

AssumeRole 通过后，执行真实 OSS 权限闭环验证：

```powershell
$env:OSS_ENDPOINT="https://s3.oss-cn-hangzhou.aliyuncs.com"
$env:OSS_REGION="cn-hangzhou"
npm.cmd run smoke:aliyun-oss-sts
```

该命令使用临时凭证验证授权前缀的 List、Put、Get、Delete，并确认跨租户前缀被拒绝。测试对象使用随机名称并在 `finally` 中清理。输出仅包含各阶段布尔结果；失败诊断只允许固定错误类型、HTTP 状态和固定阶段名。

阿里云普通公网 S3 兼容端点应使用虚拟主机寻址。Node.js AWS SDK v3 的杭州端点为 `https://s3.oss-cn-hangzhou.aliyuncs.com`，不要为该端点启用 `forcePathStyle`。

建议按这个顺序：

```text
1. 后端接数据库或简单 JSON 配置，先跑通 token -> userId。
2. 后端接阿里云 AssumeRole。
3. 使用最小权限 policy 限制到 tenants/{userId}/vaults/{vaultId}/repos/{repoId}/*。
4. 插件商业模式测试连接。
5. 两台设备做空库同步。
6. 测试凭证过期刷新。
7. 禁用用户，确认不能继续获取新凭证。
8. 测试张三不能访问李四路径。
```

## 九、上线前检查

```text
授权服务必须使用 HTTPS。
生产日志必须脱敏。
AccessKey 只放服务器环境变量。
不要把阿里云账号信息写进仓库。
不要把用户同步密码传给后端。
后端 STS 凭证有效期建议 1 小时。
插件提前 5 分钟刷新。
授权接口请求体限制为 16 KiB。
客户端 repoId 在进入 STS Policy 前必须规范为单一路径段。
未知后端错误文本不得直接展示给用户或写入日志。
监控应定期检查 /healthz 和 /readyz；/readyz 只允许输出 provider、存储类型和脱敏计数。
```

## 十、最小商业闭环

第一版商业闭环可以非常简单：

```text
用户付款
运营手工创建用户和 token
用户填写商业模式三项
用户多设备同步
退订后运营禁用 token
```

这已经具备可售卖的基本形态。后续再补自动注册、支付、管理后台和自助设备管理。

## 十一、单机生产部署

第一版推荐使用 Docker Compose 单机部署，授权后端和 Caddy HTTPS 反向代理分别运行在独立容器中：

```text
deploy/commercial-sts/compose.yaml
deploy/commercial-sts/Caddyfile
deploy/commercial-sts/.env.example
deploy/commercial-sts/README.md
Dockerfile.commercial-sts
```

生产模式要求：

```text
NODE_ENV=production
PUBLIC_BASE_URL 必须为 HTTPS
STORE_PATH 必须指向持久卷
TOKEN_SALT 与 DEVICE_SALT 必须为不同的生产随机值
RATE_LIMIT_PER_MINUTE 默认为 60，允许范围为 1 到 600
后端 8788 端口不能直接暴露到公网
```

文件存储只保存授权令牌哈希和设备 ID 哈希，写入通过临时文件原子替换。运营 CLI 签发的新令牌只写入权限受限的 `.secret` 文件，不输出到终端。详细操作见 `deploy/commercial-sts/README.md`。
