# 商业 STS 方案 B 交接：真实环境闭环已验证

更新时间：2026-07-17

## 一、项目与安全边界

项目目录：

```text
E:\project\Obsidian插件\同步功能
```

必须持续遵守：

```text
1. data.json 含授权令牌、同步密码或个人模式密钥，不要读取、输出或提交。
2. 不要在代码、文档、日志、测试快照中写入真实 AccessKey、Secret、SecurityToken、授权令牌、同步密码、设备 ID 或哈希盐。
3. .commercial-sts/、*.secret、.env* 和阿里云账号信息文件保持忽略，不要提交。
4. 日志只允许输出阶段、状态码、脱敏错误码和统计结果。
```

## 二、本轮完成状态

商业化方案 B 已完成首个真实环境 MVP 闭环，同时保留个人静态 AccessKey 模式。

插件端已经具备：

```text
credentialMode: "static" | "sts"
STS credential provider
SecurityToken 注入 S3Client
临时凭证缓存与临近过期自动刷新
授权服务地址 / 授权令牌 / 同步密码设置
第二设备安全配置复制
用户仓库命名空间隔离
敏感配置导出过滤
static 模式向后兼容
```

后端已经具备：

```text
HTTPS 凭证接口
Bearer 授权令牌校验
用户状态与设备数量校验
阿里云 STS AssumeRole
按用户、vault、repo 生成最小权限策略
JSON 持久化存储
脱敏审计日志
速率限制
健康检查、CORS 和生产预检
Docker Compose + Caddy 部署
```

## 三、真实环境验证结果

公开授权服务：

```text
https://sync.e2note.com
```

已验证：

```text
HTTPS 证书有效
/healthz 正常
CORS OPTIONS 正常
未授权请求返回 401
正式凭证接口返回短期 STS 凭证
临时凭证包含 accessKeyId、accessKeySecret、securityToken、expiration
OSS 允许前缀 List / Put / Get / Delete 成功
跨租户前缀访问被拒绝
测试对象清理成功
STS 生产预检 ready=true
```

Obsidian 双库真实联调已经完成：

```text
ObsidianSyncTestA：连接成功，上传成功
ObsidianSyncTestB：安全导入第一库配置后连接成功，下载成功
ObsidianSyncTestB：修改后反向上传成功
ObsidianSyncTestA：再次同步并拉取修改成功
```

这证明以下完整链路可执行：

```text
插件 -> HTTPS 授权服务 -> STS 临时凭证 -> OSS 仓库前缀
       -> 客户端加密上传 -> 第二设备下载 -> 客户端解密
```

## 四、本轮现场故障与修复

首次在 Obsidian 点击“测试连接”时显示：

```text
连接失败：UnknownError
```

分层诊断结果：

```text
授权服务审计显示凭证签发成功，HTTP 200。
同一临时凭证执行 HeadBucket 返回 403。
同一临时凭证对授权 repo 前缀执行 ListObjectsV2 成功。
```

根因：

```text
旧测试逻辑使用 HeadBucket 探测整个 Bucket，不符合商业 STS 的最小前缀权限模型。
同步读写权限本身没有故障。
```

修复：

```text
src/sync/RemoteStorage.ts

有 storagePrefix 和 repoId 时：
  使用 ListObjectsV2 + 精确 namespacePrefix + MaxKeys=1。

没有商业存储前缀时：
  继续使用 HeadBucket，保持 static 模式原行为。
```

回归测试位于：

```text
tests/remoteStorage.test.ts
```

覆盖：

```text
static 模式仍使用 HeadBucketCommand
命名空间 STS 模式使用 ListObjectsV2Command
STS 探测前缀精确到 tenants/.../vaults/.../repos/{repoId}/
```

## 五、当前验证基线

修复后已运行：

```text
npm.cmd test
23 个测试文件通过
147 条测试通过

npm.cmd run build
通过

git diff --check
无空白错误，仅有 Windows CRLF 提示
```

最新修复包：

```text
release\obsidian-sync-plugin-0.1.0-commercial-sts-fix-20260717-191936.zip
```

压缩包仅包含：

```text
main.js
manifest.json
styles.css
OBSIDIAN_SYNC_PLUGIN_USER_MANUAL.md
```

已确认不含 `data.json` 和其他意外文件。

## 六、当前工作区说明

当前工作树包含本轮商业 STS 的大量未提交修改和新增文件。不要 reset、checkout 或覆盖这些内容。

重点文件：

```text
src/sync/StsCredentialProvider.ts
src/sync/RemoteStorage.ts
src/sync/SyncManager.ts
src/settings/SyncSettingsTab.ts
src/types/index.ts
src/utils/ConfigExporter.ts
src/utils/ConfigValidator.ts
src/utils/errors.ts
scripts/commercial-sts-*.mjs
scripts/aliyun-*.mjs
deploy/
Dockerfile.commercial-sts
docs/COMMERCIAL_STS_BACKEND_CONTRACT.md
docs/COMMERCIAL_STS_OPERATIONS_RUNBOOK.md
tests/*sts*.test.ts
tests/remoteStorage.test.ts
```

测试库中曾存在两个相同插件 ID 的目录，修复时两个目录的 `main.js` 都已更新。后续发布整理时应在确认哪个目录保存有效 `data.json` 后，由用户备份并手工清理重复目录。不要自动删除或读取任何 `data.json`。

## 七、尚未完成，不要误判为正式商用完成

当前是可运行、可验证的商业 STS MVP，不是面向公众的完整商业系统。

仍需推进：

```text
1. 正式账户注册、登录、找回和令牌轮换流程。
2. 套餐、支付、续费、停用和设备管理后台。
3. 授权令牌安全存储策略和撤销体验。
4. 审计查询、告警、备份、恢复和监控。
5. 后端数据库迁移方案；当前 JSON store 只适合首版和小规模验证。
6. 安装器、版本升级、回滚和正式发布流程。
7. 更多异常场景：断网、凭证过期、时钟偏差、限流、OSS 故障和并发冲突。
8. 用户提示中的 UnknownError 等底层错误需要进一步友好化和脱敏。
9. 正式安全审查、依赖审计、负载测试和灾难恢复演练。
```

## 八、建议下一阶段顺序

按小步、低风险顺序执行：

```text
第一步：整理当前工作树，审查所有商业 STS 差异和敏感信息边界。
第二步：补充凭证过期、403、401、429、网络超时的插件端用户提示测试。
第三步：完成 0.1.1 版本号、变更日志、发布清单和干净安装验证。
第四步：设计最小账户后台，只做用户、令牌、设备、停用和审计查询。
第五步：再接支付和自动订阅，不要提前扩大后端复杂度。
```

每一步完成后运行：

```text
npm.cmd test
npm.cmd run build
git diff --check
```

涉及真实阿里云或用户界面验证时再通知用户，其余工作继续自主推进。
