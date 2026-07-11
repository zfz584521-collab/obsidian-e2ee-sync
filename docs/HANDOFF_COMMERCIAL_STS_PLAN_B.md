# 新窗口交接：商业化方案 B（后端 STS 临时凭证）

这个文档用于新开一个 Codex 窗口时交接上下文。目标是继续开发 Obsidian 同步插件的商业化方案 B：

```text
用户不再长期保存阿里云永久 AccessKey。
插件通过用户登录或授权，从你的后端获取短期有效的 STS 临时凭证。
后端按用户身份限制 OSS 访问路径，实现商业化多用户隔离。
```

---

## 一、当前项目位置

项目目录：

```text
E:\project\Obsidian插件\同步功能
```

重要安全要求：

```text
data.json 含密钥和同步密码，不要读取、输出、提交。
不要把真实 AccessKey、Secret、同步密码写进代码或文档。
```

当前插件已经完成：

```text
内存双设备集成测试
多 repo 隔离
旧布局检测
安全导出
密码框加固
中文设置页简化
中文使用手册
多用户仓库隔离说明
商业化多用户 OSS 访问方案文档
```

最近验证结果：

```text
npm.cmd test：12 个测试文件，91 条测试通过
npm.cmd run build：构建成功
```

最近一次本地提交：

```text
9501203 完善多设备同步和中文使用文档
```

注意：提交之后又新增了两份未提交文档：

```text
docs/MULTI_USER_REPOSITORY_ISOLATION.md
docs/COMMERCIAL_MULTI_USER_OSS_ACCESS_PLAN.md
```

---

## 二、新窗口先阅读这些文件

请先阅读：

```text
docs/COMMERCIAL_MULTI_USER_OSS_ACCESS_PLAN.md
docs/MULTI_USER_REPOSITORY_ISOLATION.md
docs/HANDOFF_MULTI_DEVICE_SYNC.md
docs/MULTI_DEVICE_SYNC_AND_RELEASE_PLAN.md
OBSIDIAN_SYNC_PLUGIN_USER_MANUAL.md
src/settings/SyncSettingsTab.ts
src/sync/RemoteStorage.ts
src/sync/SyncManager.ts
src/types/index.ts
src/utils/ConfigExporter.ts
tests/syncManager.multiDevice.test.ts
```

如果要开始实现 STS，还要重点读：

```text
src/sync/RemoteStorage.ts
src/types/index.ts
src/settings/SyncSettingsTab.ts
tests/remoteStorage.test.ts
```

---

## 三、新窗口先运行这些命令

```text
git status --short
npm.cmd test
npm.cmd run build
```

如果只是做文档，可以至少运行：

```text
git diff --check
```

---

## 四、方案 B 的目标

商业化最终目标：

```text
插件不要求普通用户填写阿里云 AccessKey ID / AccessKey Secret。
用户只需要登录你的服务，或者填写一个授权码。
插件向你的后端请求临时同步凭证。
后端返回短期有效的 STS 凭证。
插件用 STS 凭证访问 OSS。
凭证过期后，插件自动刷新。
```

用户体验目标：

```text
个人版：仍保留当前手动 AccessKey 模式。
商业版：用户只填服务器地址 / 登录令牌 / 同步密码，其他自动下发。
```

安全目标：

```text
不要把主账号 AccessKey 发给用户。
不要把长期 RAM AccessKey 发给用户。
每个用户只能访问自己的 OSS 路径。
用户停用或退订后，后端停止签发 STS 凭证。
STS 凭证短期有效，泄露后风险有限。
```

---

## 五、推荐架构

### 插件端

插件新增一种凭证模式：

```text
credentialMode: "static" | "sts"
```

static 模式：

```text
沿用当前 AccessKey ID / AccessKey Secret。
适合个人自用、本地测试、小规模手工配置。
```

sts 模式：

```text
插件保存你的后端地址和用户授权令牌。
插件启动或同步前向后端请求临时凭证。
插件拿到 AccessKey ID / AccessKey Secret / SecurityToken / Expiration。
插件使用临时凭证访问 OSS。
临时凭证快过期时自动刷新。
```

### 后端

后端负责：

```text
用户登录 / 授权
校验会员状态
校验设备数量
按用户 ID 生成 OSS 路径
调用阿里云 STS AssumeRole
返回临时凭证
记录审计日志
用户停用后拒绝发放凭证
```

### OSS 远端路径

建议：

```text
bucket: obsidian-sync-commercial
prefix: tenants/{userId}/vaults/{vaultId}/
```

例如：

```text
tenants/u_10001/vaults/main/
tenants/u_10002/vaults/main/
```

---

## 六、插件端建议新增配置

在配置类型里新增：

```ts
credentialMode: "static" | "sts";
authServerUrl?: string;
authToken?: string;
stsRefreshSkewMs?: number;
```

运行时缓存，不建议持久化到 data.json，或至少不要明文暴露：

```ts
temporaryAccessKeyId?: string;
temporaryAccessKeySecret?: string;
securityToken?: string;
expiration?: string;
```

也可以把 STS 凭证只放内存，不写入配置文件。

---

## 七、插件端建议新增模块

建议新增：

```text
src/sync/StsCredentialProvider.ts
```

职责：

```text
判断当前临时凭证是否存在
判断是否快过期
向后端请求新凭证
缓存临时凭证
给 RemoteStorage 提供当前可用凭证
隐藏日志中的 token / secret / securityToken
```

建议测试：

```text
tests/stsCredentialProvider.test.ts
```

覆盖：

```text
首次请求凭证
未过期时复用凭证
快过期时刷新
后端错误时给出中文错误
不会把敏感信息写入日志
```

---

## 八、RemoteStorage 需要支持 SecurityToken

当前 RemoteStorage 大概率只支持：

```text
accessKeyId
secretKey
```

STS 模式还需要：

```text
securityToken
```

开发时要确认底层 S3/OSS 请求签名是否支持 session token。

如果当前是自己实现 S3 签名，需要在请求头里加入：

```text
x-amz-security-token
```

或者阿里云 OSS 兼容模式对应的安全 token 头。实现前要确认当前 RemoteStorage 的签名逻辑。

---

## 九、设置页建议

不要让普通商业用户看到复杂的 AccessKey 字段。

建议设置页分两种模式：

```text
个人模式：手动填写对象存储信息。
商业模式：填写服务地址 / 登录令牌 / 同步密码。
```

商业模式最少字段：

```text
授权服务地址
授权令牌或登录码
同步密码
```

由后端自动下发：

```text
OSS endpoint
bucket
storagePrefix
repoId
STS 临时凭证
```

---

## 十、后端接口草案

插件请求：

```http
POST /api/sync/credentials
Authorization: Bearer <用户登录令牌>
Content-Type: application/json
```

请求体：

```json
{
  "vaultId": "main",
  "deviceId": "device_xxx",
  "pluginVersion": "0.1.0"
}
```

后端返回：

```json
{
  "endpoint": "https://oss-cn-hangzhou.aliyuncs.com",
  "bucket": "obsidian-sync-commercial",
  "region": "cn-hangzhou",
  "storagePrefix": "tenants/u_10001/vaults/main",
  "repoId": "main",
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
上面的值是示例，不要写真实密钥。
```

---

## 十一、后端开发建议

后端可以单独做一个项目，不一定放在 Obsidian 插件仓库里。

最小后端职责：

```text
用户表
订阅状态
设备表
vault 表
STS 签发接口
审计日志
管理员禁用用户
```

早期可以先实现：

```text
固定 token -> 固定 userId
固定 userId -> 固定 OSS prefix
调用 STS -> 返回临时凭证
```

跑通后再做：

```text
账号登录
付费状态
设备限制
管理后台
自动续费/停用
```

---

## 十二、开发顺序建议

第一步：插件端类型和接口预留

```text
新增 credentialMode
新增 StsCredentialProvider
RemoteStorage 支持 securityToken
加单元测试
```

第二步：插件设置页增加商业模式

```text
模式切换：个人模式 / 商业模式
商业模式只显示授权服务地址、授权令牌、同步密码
隐藏 AccessKey 字段
```

第三步：做一个本地 mock 后端

```text
返回假 STS 凭证结构
验证插件请求、刷新、错误提示逻辑
```

第四步：真实后端接阿里云 STS

```text
AssumeRole
按 userId 下发 tenants/{userId}/ 路径权限
过期刷新
停用用户
```

第五步：端到端测试

```text
张三两台电脑能同步
李四两台电脑能同步
张三不能访问李四路径
凭证过期后能刷新
停用用户后不能继续同步
```

---

## 十三、不要做的大重构

当前用户要求是小步开发，不要大重构。

避免：

```text
一次性重写 SyncManager
一次性重写 RemoteStorage
删除个人模式
把所有设置逻辑推倒重来
把真实密钥写进测试
读取或提交 data.json
```

推荐：

```text
先保留当前 static AccessKey 模式。
新增 sts 模式作为并行能力。
每一步都有测试。
每一步都能构建通过。
```

---

## 十四、新窗口可直接复制的提示词

下面这段可以直接复制到新开的 Codex 窗口：

```text
继续开发 E:\project\Obsidian插件\同步功能 这个 Obsidian 同步插件。

目标：开发商业化方案 B，也就是“后端 STS 临时凭证”模式。个人自用的静态 AccessKey 模式要保留，新增商业模式，不要大重构。

请先阅读：
1. docs/HANDOFF_COMMERCIAL_STS_PLAN_B.md
2. docs/COMMERCIAL_MULTI_USER_OSS_ACCESS_PLAN.md
3. docs/MULTI_USER_REPOSITORY_ISOLATION.md
4. docs/HANDOFF_MULTI_DEVICE_SYNC.md
5. docs/MULTI_DEVICE_SYNC_AND_RELEASE_PLAN.md
6. OBSIDIAN_SYNC_PLUGIN_USER_MANUAL.md
7. src/settings/SyncSettingsTab.ts
8. src/sync/RemoteStorage.ts
9. src/sync/SyncManager.ts
10. src/types/index.ts
11. tests/remoteStorage.test.ts
12. tests/syncManager.multiDevice.test.ts

请先运行：
git status --short
npm.cmd test
npm.cmd run build

注意：
- data.json 含密钥和同步密码，不要读取、输出、提交。
- 不要把真实 AccessKey、Secret、SecurityToken、同步密码写进代码或文档。
- 当前个人模式已经可用，功能验证成功。
- 新功能要小步开发，保留 static 模式，新增 sts 模式。
- 优先做插件端架构预留：credentialMode、STS credential provider、RemoteStorage 支持 securityToken、对应测试。
- 后端可以先写接口草案或 mock，不要一上来大重构。

期望方案：
- static 模式：沿用当前用户手填 AccessKey。
- sts 模式：用户填写授权服务地址 / 授权令牌 / 同步密码，插件向后端获取临时凭证。
- 临时凭证包括 accessKeyId、accessKeySecret、securityToken、expiration。
- 插件应在凭证快过期时自动刷新。
- 日志必须隐藏 token、secret、securityToken、同步密码、设备 ID 等敏感信息。

完成每一步后运行测试和构建；需要我测试真实阿里云 STS 时再告诉我。
```

---

## 十五、完成标准

第一阶段可以认为完成，当：

```text
类型层支持 static / sts
新增 StsCredentialProvider
RemoteStorage 可以接收 securityToken
设置页能切换个人模式 / 商业模式
单元测试覆盖凭证获取和刷新
npm.cmd test 通过
npm.cmd run build 通过
```

第二阶段完成，当：

```text
插件能连接 mock 后端获取临时凭证
插件能使用临时凭证完成一次同步
凭证过期后能自动刷新
中文错误提示清楚
```

第三阶段完成，当：

```text
真实阿里云 STS 接入成功
不同用户路径隔离成功
停用用户后无法继续同步
```
