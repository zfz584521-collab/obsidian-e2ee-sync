# Obsidian 同步插件：阿里云 OSS 配置与排障记录

> 文档日期：2026-06-10  
> 适用项目：`obsidian-sync-plugin`  
> 存储服务：阿里云对象存储 OSS  
> Bucket 地域：华东 1（杭州）  
> 文档目的：完整记录本次同步功能的选型、云端配置、故障排查、代码修复、安全处置和后续操作。

## 1. 最终方案概览

本项目最终选择阿里云 OSS 作为 Obsidian 跨设备同步的远端对象存储。

选择阿里云 OSS 的主要原因：

1. 支持国内账号注册、实名认证和国内支付方式。
2. 提供标准对象存储能力。
3. 提供与 Amazon S3 API 兼容的访问方式。
4. 可以通过 RAM 用户和自定义权限策略限制插件的访问范围。
5. 可以把同步数据保存在私有 Bucket 中。

本次使用的非敏感配置如下：

| 配置项 | 值 |
|---|---|
| 云服务 | 阿里云 OSS |
| Bucket | `zhaofangzhen` |
| 地域 | 华东 1（杭州） |
| Endpoint | `https://oss-cn-hangzhou.aliyuncs.com` |
| Region | `cn-hangzhou` |
| 存储类型 | 标准存储 |
| 读写权限 | 私有 |
| RAM 用户 | `obsidian-sync` |
| 自定义策略 | `ObsidianSyncOSS` |
| 自动同步 | 初次配置期间关闭 |
| 同步间隔 | `0`，即仅手动同步 |

以下内容属于敏感信息，不应写入文档、聊天记录、截图或 Git：

- AccessKey ID
- AccessKey Secret
- 同步密码
- 插件 `data.json` 中的完整认证配置

## 2. 当前状态

截至 2026-06-10，已完成以下工作：

- 阿里云 OSS Bucket 已创建。
- Bucket 已设置为私有读写。
- RAM 用户已创建。
- Bucket 限定权限策略已创建并授权。
- OSS 跨域规则已创建并验证生效。
- 已确认阿里云 OSS 服务端可以通过同一组配置执行 `HeadBucket`。
- 插件已支持阿里云 OSS 的虚拟主机寻址方式。
- 插件已改用 Obsidian `requestUrl` 传输请求，绕过 Electron 浏览器层的 `fetch/CORS` 限制。
- 插件响应体已转换为 AWS SDK 可消费的 Web `ReadableStream`。
- 全部自动化测试通过：`71/71`。
- TypeScript 检查和生产构建成功。

最后仍需人工确认：

1. 在 Obsidian 中执行“重新加载应用”。
2. 使用已经轮换的新 AccessKey。
3. 设置未泄露的新同步密码。
4. 再次点击“测试连接”。
5. 连接成功后执行首次手动同步。

## 3. 完整处理时间线

### 3.1 初始需求

目标是在 Obsidian 中配置一个跨设备、端到端加密的同步功能。插件要求提供一个 S3 兼容对象存储，包括：

- 服务端点
- 存储桶
- Access Key ID
- Secret Access Key
- Region
- 同步密码
- 设备名称

用户不熟悉对象存储，因此由配置过程代为完成技术选型。

### 3.2 首次选择 Cloudflare R2

最初选择 Cloudflare R2，原因是：

- S3 API 兼容性较好。
- 免费额度通常足够个人 Obsidian 仓库使用。
- 没有出口流量费。

实际开通时，Cloudflare 要求绑定银行卡、Apple Pay 或 PayPal。由于用户没有可用的海外银行卡，因此放弃该方案。

### 3.3 国内云服务选型

随后考虑过腾讯云 COS，最终根据用户偏好选择阿里云 OSS。

选择阿里云后发现一个重要兼容问题：

- 阿里云 OSS 要求使用虚拟主机形式的 Bucket 地址。
- 原插件对所有非 AWS Endpoint 都强制启用路径式寻址。
- 因此原插件不能直接可靠连接阿里云 OSS。

由此决定先修改插件，再完成云端配置。

### 3.4 创建 OSS Bucket

在阿里云 OSS 控制台创建 Bucket：

| 项目 | 配置 |
|---|---|
| Bucket 名称 | `zhaofangzhen` |
| 地域 | 华东 1（杭州） |
| Endpoint | `oss-cn-hangzhou.aliyuncs.com` |
| 存储类型 | 标准存储 |
| 阻止公共访问 | 开启 |
| 读写权限 | 私有 |
| 版本控制 | 未开启 |
| 服务端加密 | 无 |

该配置适合个人同步用途。Bucket 不需要公开访问，插件使用签名请求进行读写。

### 3.5 创建 RAM 用户

创建了独立的 RAM 用户：

```text
obsidian-sync
```

只为该用户启用程序访问所需的 AccessKey，不使用主账号 AccessKey。

这是必要的安全隔离：

- 主账号权限过大。
- 插件只需要访问一个 Bucket。
- RAM 用户密钥泄露时，可以单独禁用和轮换。

### 3.6 创建最小范围权限策略

没有直接授予系统策略 `AliyunOSSFullAccess`，因为该策略可以管理账号下所有 OSS 资源，权限明显超过插件需要。

创建了自定义策略：

```text
ObsidianSyncOSS
```

策略内容：

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "oss:*",
      "Resource": [
        "acs:oss:*:*:zhaofangzhen",
        "acs:oss:*:*:zhaofangzhen/*"
      ]
    },
    {
      "Effect": "Deny",
      "Action": "oss:DeleteBucket",
      "Resource": "acs:oss:*:*:zhaofangzhen"
    }
  ]
}
```

策略效果：

- RAM 用户只能访问 `zhaofangzhen` Bucket 及其对象。
- 允许插件执行同步所需的对象操作。
- 明确禁止删除 Bucket 本身。
- 不授予其他 OSS Bucket 的访问权限。

该策略随后授权给 RAM 用户 `obsidian-sync`。

## 4. 阿里云 OSS 标准配置 SOP

### 4.1 创建 Bucket

1. 登录阿里云 OSS 控制台。
2. 点击“创建 Bucket”。
3. Bucket 名称使用全局唯一名称。
4. 地域选择距离主要使用地点较近的区域。
5. 存储类型选择“标准存储”。
6. 读写权限选择“私有”。
7. 开启“阻止公共访问”。
8. 其他高级功能保持默认，后续按需启用。

注意：

- Bucket 名称创建后不能修改。
- 地域创建后不能修改。
- Endpoint 必须与地域一致。

### 4.2 创建 RAM 用户

1. 打开 RAM 访问控制。
2. 进入“用户”。
3. 创建用户，例如 `obsidian-sync`。
4. 只开启程序访问所需的 AccessKey。
5. 创建后立即把 AccessKey ID 和 AccessKey Secret 保存到密码管理器。
6. 不要通过聊天、截图、邮件或明文笔记传输 Secret。

### 4.3 创建权限策略

1. 进入“权限策略”。
2. 点击“创建权限策略”。
3. 选择“脚本编辑”。
4. 使用上一节中的策略 JSON。
5. 把 Bucket 名替换成实际名称。
6. 提交后填写策略名称。
7. 将策略授权给专用 RAM 用户。

### 4.4 创建跨域规则

进入：

```text
OSS 控制台
→ Bucket
→ 数据安全
→ 跨域设置
→ 创建规则
```

规则如下：

| 字段 | 值 |
|---|---|
| 来源 | `*` |
| Methods | `GET`、`POST`、`PUT`、`DELETE`、`HEAD` |
| 允许 Headers | `*` |
| 暴露 Headers | `ETag`、`x-oss-request-id` |
| 缓存时间 | `600` 秒 |
| 返回 Vary: Origin | 开启 |

阿里云控制台提示规则可能需要最多 15 分钟生效。

本次通过外部预检请求验证到以下响应，证明规则已经生效：

```text
Status: 200
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, HEAD
Vary: Origin
```

### 4.5 插件字段填写

在 Obsidian 插件设置中填写：

```text
服务端点：https://oss-cn-hangzhou.aliyuncs.com
存储桶：zhaofangzhen
访问密钥：新的 AccessKey ID
访问密钥密码：新的 AccessKey Secret
区域：cn-hangzhou
同步密码：使用密码管理器生成并保存的强密码
设备名称：我的电脑
自动同步：关闭
同步间隔：0
```

Endpoint 中不要包含 Bucket 名。AWS SDK 会根据虚拟主机寻址规则自动构造：

```text
https://zhaofangzhen.oss-cn-hangzhou.aliyuncs.com
```

## 5. 故障一：阿里云 OSS 寻址模式不兼容

### 5.1 症状

原插件客户端配置包含：

```ts
forcePathStyle: !config.endpoint.includes('amazonaws.com')
```

该逻辑会让所有非 AWS 服务使用路径式访问。例如：

```text
https://oss-cn-hangzhou.aliyuncs.com/zhaofangzhen
```

而阿里云 OSS 的 S3 兼容接口需要虚拟主机方式：

```text
https://zhaofangzhen.oss-cn-hangzhou.aliyuncs.com
```

### 5.2 根因

原代码只把 `amazonaws.com` 识别为虚拟主机模式服务，没有识别 `aliyuncs.com`。

### 5.3 修复

新增寻址判断：

```ts
export function shouldForcePathStyle(endpoint: string): boolean {
  const hostname = new URL(endpoint).hostname.toLowerCase();
  return !(
    hostname === 'amazonaws.com' ||
    hostname.endsWith('.amazonaws.com') ||
    hostname === 'aliyuncs.com' ||
    hostname.endsWith('.aliyuncs.com')
  );
}
```

并将 S3 客户端配置改为：

```ts
forcePathStyle: shouldForcePathStyle(config.endpoint)
```

效果：

- AWS S3：虚拟主机方式。
- 阿里云 OSS：虚拟主机方式。
- MinIO 等通用 S3 服务：保留路径式访问。

### 5.4 测试

新增测试验证：

- `oss-cn-hangzhou.aliyuncs.com` 返回 `false`。
- `minio.example.com` 返回 `true`。

测试按 TDD 流程执行：

1. 先写测试。
2. 测试因函数不存在而失败。
3. 实现最小逻辑。
4. 测试通过。

## 6. 故障二：Obsidian 中出现 `Failed to fetch`

### 6.1 症状

插件点击“测试连接”后显示：

```text
连接失败：Failed to fetch
```

同时，使用本机 Node.js 和同样配置执行 `HeadBucket` 却成功：

```text
HEAD_BUCKET_OK
```

### 6.2 已排除因素

通过逐层验证排除了：

- Endpoint 填写错误。
- Bucket 名称错误。
- Region 错误。
- AccessKey 无效。
- RAM 用户未授权。
- Bucket 私有权限导致无法访问。
- OSS 服务端不可达。
- 跨域规则未保存。
- Obsidian 加载了旧版 `main.js`。

### 6.3 CORS 排查过程

首次检查 OSS 预检请求时，服务端返回：

```text
Status: 403
Access-Control-Allow-Origin: 未返回
```

这表明当时 CORS 规则尚未生效。

规则保存并等待传播后，再次检查：

```text
Status: 200
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, HEAD
```

随后使用 AWS SDK 可能发送的完整请求头进行预检：

```text
amz-sdk-invocation-id
amz-sdk-request
authorization
x-amz-content-sha256
x-amz-date
x-amz-user-agent
```

服务端仍然返回 `200`，说明 CORS 配置已经正确。

### 6.4 根因

虽然 OSS 的 CORS 已正确配置，但插件运行在 Obsidian 的 Electron 环境中。AWS SDK 默认传输层使用浏览器 `fetch`，该运行组合仍在签名请求阶段产生网络层失败。

也就是说：

- OSS 服务端正常。
- CORS 正常。
- 凭据正常。
- 故障发生在 Electron 浏览器传输层。

### 6.5 修复方案

新增 `ObsidianHttpHandler`，把 AWS SDK 的 HTTP 请求通过 Obsidian 官方提供的 `requestUrl` 发送。

该适配器负责：

1. 从 Smithy/AWS SDK 请求结构构造 URL。
2. 保留 AWS 签名相关 Header。
3. 移除不能手动设置的 `host` 和 `content-length`。
4. 转换字符串和二进制请求体。
5. 使用 `requestUrl` 发起请求。
6. 将 Obsidian 响应转换回 AWS SDK 需要的响应结构。
7. 关闭 `requestUrl` 对 HTTP 4xx/5xx 的自动抛错，让 AWS SDK 自己解析服务端错误。

S3 客户端改为：

```ts
requestHandler: new ObsidianHttpHandler()
```

### 6.6 AWS 查询字符串编码

适配器测试发现，不能直接使用 `URLSearchParams`：

```text
空格 → +
```

AWS 签名规范需要：

```text
空格 → %20
```

如果实际发送 URL 与签名时使用的 URL 编码不同，OSS 会返回签名不匹配。

因此适配器使用 `encodeURIComponent` 手动构造查询字符串，确保空格编码为 `%20`。

## 7. 故障三：`stream.getReader is not a function`

### 7.1 症状

修复网络传输后，错误变为：

```text
连接失败：stream.getReader is not a function
```

这个变化非常重要，因为它说明：

- 请求已经成功离开 Obsidian。
- OSS 已经返回响应。
- 故障从网络层推进到了响应解析层。

### 7.2 根因

`ObsidianHttpHandler` 初版把响应体直接作为 `ArrayBuffer` 返回：

```ts
body: response.arrayBuffer
```

当前 AWS SDK 浏览器流解析逻辑期望响应体是 Web `ReadableStream`，并调用：

```ts
stream.getReader()
```

`ArrayBuffer` 没有 `getReader()` 方法，因此抛出该错误。

### 7.3 修复

把响应体包装为标准 Web `ReadableStream<Uint8Array>`：

```ts
private toReadableStream(body: ArrayBuffer): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(body));
      controller.close();
    },
  });
}
```

随后返回：

```ts
body: this.toReadableStream(response.arrayBuffer)
```

### 7.4 测试

先修改测试，要求响应体支持：

```ts
const reader = result.response.body.getReader();
```

测试首先复现与 Obsidian 完全相同的错误：

```text
TypeError: result.response.body.getReader is not a function
```

完成流包装后，测试验证：

1. 第一次读取返回完整二进制数据。
2. 第二次读取返回 `done: true`。

## 8. 代码修改汇总

### 8.1 新增文件

```text
src/sync/ObsidianHttpHandler.ts
tests/obsidianHttpHandler.test.ts
```

### 8.2 修改文件

```text
src/sync/RemoteStorage.ts
tests/remoteStorage.test.ts
```

### 8.3 `RemoteStorage.ts`

主要改动：

- 新增 `shouldForcePathStyle()`。
- 阿里云 OSS 使用虚拟主机寻址。
- S3 客户端接入 `ObsidianHttpHandler`。

### 8.4 `ObsidianHttpHandler.ts`

主要职责：

- AWS SDK 请求到 Obsidian 请求的协议适配。
- AWS 风格 URL 查询参数编码。
- 二进制请求体转换。
- Header 过滤。
- Obsidian 响应到 AWS SDK 响应的协议适配。
- `ArrayBuffer` 到 Web `ReadableStream` 的转换。

### 8.5 测试文件

新增或补充的测试覆盖：

- 阿里云 Endpoint 使用虚拟主机寻址。
- MinIO 继续使用路径式寻址。
- HTTP 方法、URL、Header 和请求体正确传给 `requestUrl`。
- 查询参数中的空格编码为 `%20`。
- 无值查询参数保留为 `?flag` 而不是 `?flag=`。
- 返回状态码和 Header 正确传回 AWS SDK。
- 响应体支持 `getReader()`。
- 响应二进制内容保持不变。

## 9. 验证记录

### 9.1 阿里云服务端验证

使用同样的 Endpoint、Bucket、Region 和凭据执行 `HeadBucket`：

```text
HEAD_BUCKET_OK
```

该验证证明：

- DNS 和网络可达。
- Endpoint 正确。
- Bucket 存在。
- Region 正确。
- AccessKey 有效。
- RAM 权限有效。

### 9.2 CORS 验证

最终预检结果：

```text
Status: 200
Allow-Origin: *
Allow-Methods: GET, POST, PUT, DELETE, HEAD
```

### 9.3 自动化测试

最终测试命令：

```bash
npm test
```

最终结果：

```text
Test Files  8 passed (8)
Tests       71 passed (71)
```

### 9.4 生产构建

构建命令：

```bash
npm run build
```

构建内容：

```text
tsc -noEmit -skipLibCheck
node esbuild.config.mjs production
```

结果：退出码 `0`，构建成功。

### 9.5 插件安装路径验证

同步插件目录是一个 Junction：

```text
E:\Obsidian\.obsidian\plugins\obsidian-sync-plugin
→ E:\project\Obsidian插件\同步功能
```

因此项目目录中的 `main.js` 构建完成后，Obsidian 插件目录会立即看到同一文件，不需要手动复制。

Obsidian 仍需执行“重新加载应用”，才能让运行中的插件代码更新。

## 10. 安全事件与必要处置

### 10.1 已发生的问题

配置过程中，截图曾包含：

- AccessKey ID
- AccessKey Secret
- 同步密码

这些凭据一旦出现在截图或聊天记录中，应视为已经泄露，不能继续使用。

### 10.2 必须执行的操作

1. 登录阿里云 RAM 控制台。
2. 打开用户 `obsidian-sync`。
3. 禁用并删除截图中出现过的旧 AccessKey。
4. 创建新的 AccessKey。
5. 把新密钥保存到密码管理器。
6. 在 Obsidian 插件中替换旧密钥。
7. 生成一个全新的同步密码。
8. 不再使用截图中出现过的旧同步密码。
9. 不要再截取包含凭据的插件设置页面。

### 10.3 本地明文存储风险

当前插件会把以下内容直接保存在插件的 `data.json`：

- AccessKey ID
- AccessKey Secret
- 同步密码

当前实现没有对这些设置进行额外加密。

因此：

- 不要把 `data.json` 提交到 Git。
- 不要把插件数据目录上传到公共网盘。
- 不要将整个 `.obsidian` 目录公开分享。
- 不要让不可信程序读取 Obsidian 仓库目录。
- 操作系统账号应设置登录密码。
- 建议启用磁盘加密或设备加密。

### 10.4 `.gitignore`

项目根目录中的 `data.json` 应始终保持忽略状态。建议确认 `.gitignore` 至少包含：

```gitignore
data.json
```

提交代码前执行：

```bash
git status --short
```

确认没有凭据文件进入暂存区。

## 11. 首次同步操作

连接测试成功后，不要立即打开自动同步。建议按以下顺序操作。

### 11.1 准备

1. 备份当前 Obsidian 仓库。
2. 确认旧 AccessKey 已删除。
3. 确认插件已填写新 AccessKey。
4. 确认同步密码是新的且已经保存。
5. 确认设备名称清晰，例如“主电脑”。
6. 保持自动同步关闭。
7. 保持同步间隔为 `0`。

### 11.2 小范围验证

1. 在仓库根目录创建测试文件：

```text
sync-test.md
```

2. 写入一小段容易识别的内容。
3. 点击“立即同步”。
4. 等待同步结束。
5. 打开 OSS 控制台查看 Bucket 是否产生对象。
6. 不要尝试直接阅读对象内容；插件会对内容和路径进行加密。

### 11.3 完整首次同步

小范围测试成功后：

1. 再次备份仓库。
2. 点击“立即同步”。
3. 首次同步期间不要同时大量修改文件。
4. 不要关闭 Obsidian。
5. 检查插件状态和错误提示。
6. 同步完成后查看本地文件数量、上传数量和错误数量。

## 12. 第二台设备配置

第二台设备必须使用与第一台设备相同的：

- Endpoint
- Bucket
- Region
- AccessKey ID
- AccessKey Secret
- 同步密码
- 同一远端仓库标识

第二台设备必须使用不同的：

- 设备名称
- 设备 ID

推荐步骤：

1. 在第二台设备安装同版本插件。
2. 先备份第二台设备上的仓库。
3. 填写相同 OSS 配置。
4. 填写完全相同的同步密码。
5. 设置不同设备名称，例如“笔记本电脑”。
6. 保持自动同步关闭。
7. 测试连接。
8. 手动同步。
9. 检查测试文件是否出现。
10. 确认双向修改和冲突策略正常后，再考虑自动同步。

## 13. 同步密码规则

同步密码用于端到端加密，不是阿里云账号密码，也不是 AccessKey Secret。

要求：

- 所有设备必须完全一致。
- 大小写、符号和空格都必须一致。
- 建议至少 20 个字符。
- 建议由密码管理器随机生成。
- 必须永久保存。

如果忘记同步密码：

- 远端加密数据无法恢复。
- 需要清空远端同步数据。
- 所有设备使用新密码重新建立同步仓库。

## 14. 常见错误诊断

### 14.1 `Failed to fetch`

可能原因：

- Obsidian 仍在运行旧版插件。
- Endpoint 或 URL 构造错误。
- CORS 规则未保存或尚未生效。
- Electron 浏览器传输层不兼容。

当前项目已经通过 `ObsidianHttpHandler` 绕过浏览器 `fetch`。

处理：

1. 执行“重新加载应用”。
2. 确认 `main.js` 是最新构建。
3. 检查 OSS 跨域规则。
4. 检查开发者工具 Console。

### 14.2 `stream.getReader is not a function`

原因：传输适配器返回了 `ArrayBuffer`，而 AWS SDK 需要 Web `ReadableStream`。

当前项目已经修复。

### 14.3 `AccessDenied`

检查：

- 自定义策略是否授权给正确 RAM 用户。
- 策略中的 Bucket 名是否正确。
- 是否误用了其他 RAM 用户的 AccessKey。
- 策略版本是否已生效。

### 14.4 `SignatureDoesNotMatch`

检查：

- AccessKey Secret 是否复制完整。
- Region 是否为 `cn-hangzhou`。
- Endpoint 是否为杭州 Endpoint。
- 查询字符串是否被二次编码。
- URL 空格是否编码为 `%20` 而不是 `+`。
- 本机系统时间是否准确。

### 14.5 `NoSuchBucket`

检查：

- Bucket 名是否为 `zhaofangzhen`。
- Endpoint 地域是否匹配。
- 是否在字段中意外加入空格。

### 14.6 `CONFIG_MISSING`

插件要求以下字段全部存在：

- Endpoint
- Bucket
- AccessKey ID
- AccessKey Secret
- 同步密码

同步密码为空时，即使 OSS 参数正确，插件仍会认为配置不完整。

## 15. 后续工程改进建议

### 15.1 凭据安全

优先级最高：

- 不在 `data.json` 中明文保存 Secret。
- 桌面端使用系统凭据库。
- 移动端使用平台安全存储。
- 设置界面中的 Secret 使用密码输入框。
- 日志中禁止输出凭据或完整签名 URL。

### 15.2 服务商配置预设

增加存储服务选择：

```text
AWS S3
Cloudflare R2
阿里云 OSS
腾讯云 COS
MinIO
自定义 S3
```

选择阿里云 OSS 后自动：

- 设置虚拟主机寻址。
- 根据地域生成 Endpoint。
- 设置 Region。
- 显示 RAM 和 CORS 配置说明。

### 15.3 连接诊断

将模糊错误：

```text
Failed to fetch
```

改为分层诊断：

- 配置缺失
- DNS/网络失败
- CORS 失败
- 身份验证失败
- 权限不足
- Bucket 不存在
- Region 不匹配
- 签名不匹配
- 响应体解析失败

### 15.4 配置导出安全

配置导出必须：

- 默认移除 AccessKey。
- 默认移除同步密码。
- 明确提示用户在目标设备重新输入。
- 如果导出敏感配置，必须使用强加密和独立导出密码。

### 15.5 集成测试

建议增加可选的真实 OSS 集成测试：

1. 使用环境变量提供临时凭据。
2. 创建测试前缀。
3. 执行 `HeadBucket`。
4. 上传小对象。
5. 下载并校验内容。
6. 列出对象。
7. 删除对象。
8. 清理测试前缀。

测试不得输出 AccessKey 或签名 Header。

## 16. 最终检查清单

### 云端

- [x] Bucket 已创建。
- [x] Bucket 为私有。
- [x] 阻止公共访问已开启。
- [x] RAM 用户已创建。
- [x] 自定义权限策略已创建。
- [x] 自定义策略已授权给 RAM 用户。
- [x] 禁止删除 Bucket。
- [x] CORS 规则已保存。
- [x] CORS 预检返回 `200`。
- [ ] 已删除截图中泄露的旧 AccessKey。
- [ ] 已创建并使用新的 AccessKey。

### 插件

- [x] 阿里云 OSS 使用虚拟主机寻址。
- [x] Obsidian `requestUrl` 传输适配器已接入。
- [x] AWS 查询参数编码已处理。
- [x] 响应体已转换为 `ReadableStream`。
- [x] 全部 71 项测试通过。
- [x] 生产构建成功。
- [ ] Obsidian 已重新加载最新插件。
- [ ] 新同步密码已设置并保存。
- [ ] “测试连接”已在最终版本中确认成功。
- [ ] 首次手动同步已完成。
- [ ] 第二设备同步已验证。

### 安全

- [ ] 已删除旧 AccessKey。
- [ ] 新 AccessKey 未出现在截图或聊天中。
- [ ] 旧同步密码已废弃。
- [ ] 新同步密码保存在密码管理器中。
- [ ] `data.json` 未被 Git 跟踪。
- [ ] Obsidian 仓库已完成本地备份。

## 17. 结论

本次问题不是单一的“阿里云配置错误”，而是连续三个独立层级的问题：

1. **S3 寻址层**：阿里云 OSS 需要虚拟主机寻址，原插件错误地强制使用路径式寻址。
2. **网络传输层**：AWS SDK 默认浏览器 `fetch` 在 Obsidian Electron 环境中出现 `Failed to fetch`，需要改用 Obsidian `requestUrl`。
3. **响应解析层**：`requestUrl` 返回的 `ArrayBuffer` 不能直接交给 AWS SDK，需要包装成 Web `ReadableStream`。

此外还发现并处理了两个配置和安全问题：

- OSS CORS 规则需要保存并等待传播生效。
- AccessKey 和同步密码曾出现在截图中，必须全部轮换。

目前代码侧修复和自动化验证已经完成。剩余工作是轮换凭据、重新加载 Obsidian、确认最终连接测试，并执行首次小范围同步。
