# Obsidian E2EE Sync

一个面向 Obsidian 的端到端加密多设备同步插件，支持阿里云 OSS、MinIO、Cloudflare R2、Amazon S3 等 S3 兼容对象存储。

如果你想把 Obsidian 笔记同步到自己的对象存储，而不是交给第三方同步服务托管，这个插件就是为这个场景准备的。

```text
第一台电脑：填写对象存储信息 -> 设置同步密码 -> 同步
第二台电脑：粘贴配置 -> 补充密钥和同步密码 -> 同步
```

---

## 适合谁

这个插件适合：

- 想用自己的阿里云 OSS / S3 兼容存储同步 Obsidian 的用户。
- 想让两台、三台或更多电脑保持同一份笔记的人。
- 希望笔记在上传前先加密，不把明文交给对象存储服务商的人。
- 想自己掌控同步数据、同步路径和访问密钥的团队或个人。

不适合：

- 完全不想配置对象存储的人。
- 需要移动端完整验证的人。
- 希望立即获得商业 SaaS 账号体系的人，当前版本仍以自托管配置为主。

---

## 核心特性

- **端到端加密**：笔记内容上传前加密，远端对象存储保存的是加密数据。
- **S3 兼容存储**：支持阿里云 OSS 以及常见 S3-compatible storage。
- **多设备同步**：同一个仓库 ID / 同步通道 + 同一个同步密码，即可在多台电脑间同步。
- **安全配置导出**：第二台设备使用“复制第二台配置 / 粘贴配置”，不会复制 `data.json` 和设备 ID。
- **多用户隔离**：不同用户可使用不同同步通道、仓库 ID、同步密码或不同访问密钥。
- **旧布局检测与迁移入口**：保留旧版远端布局检测和迁移能力。
- **中文设置页和中文手册**：普通用户只需要理解最少字段。
- **测试覆盖**：包含同步、多设备、配置导出、日志脱敏、配置校验等测试。

---

## 安装方式

当前还不是 Obsidian 官方社区插件，需要手动安装。

### 方式一：使用发布包

如果你拿到的是压缩包，解压后把整个插件文件夹放到：

```text
你的笔记库\.obsidian\plugins\
```

最终结构应类似：

```text
你的笔记库\.obsidian\plugins\obsidian-e2ee-sync\main.js
你的笔记库\.obsidian\plugins\obsidian-e2ee-sync\manifest.json
你的笔记库\.obsidian\plugins\obsidian-e2ee-sync\styles.css
```

然后打开 Obsidian：

```text
设置 -> 第三方插件 -> 启用 E2EE Sync
```

### 方式二：从源码构建

```powershell
npm.cmd install
npm.cmd run build
```

然后复制这些文件到 Obsidian 插件目录：

```text
main.js
manifest.json
styles.css
```

不要复制：

```text
data.json
```

`data.json` 是每台电脑自己的本地配置文件，可能包含访问密钥、同步密码和设备身份。

---

## 快速开始

进入插件设置页：

```text
设置 -> E2EE Sync
```

### 第一台电脑

只填写 5 项：

| 字段 | 说明 |
|---|---|
| 服务地址 | 对象存储 endpoint，例如阿里云 OSS 地址 |
| 存储桶名称 | bucket 名称 |
| 访问密钥 ID | 对象存储服务商提供的 AccessKey ID |
| 访问密钥密码 | 对象存储服务商提供的 AccessKey Secret |
| 同步密码 | 你自己设置的加密密码，其他设备必须完全一样 |

然后点击：

```text
检查配置
测试连接
同步
复制第二台配置
```

### 第二台 / 第三台电脑

先安装同一个插件包。

不要从第一台复制：

```text
data.json
```

打开插件设置页后点击：

```text
粘贴配置
```

再补充 3 项：

| 字段 | 说明 |
|---|---|
| 访问密钥 ID | 和第一台一样，或能访问同一个 bucket 的密钥 |
| 访问密钥密码 | 上面访问密钥对应的 Secret |
| 同步密码 | 必须和第一台完全一样 |

最后点击：

```text
检查配置
测试连接
同步
```

---

## 访问密钥和同步密码怎么理解

这三个字段经常容易混：

| 字段 | 谁提供 | 是否能自己写 | 用途 |
|---|---|---|---|
| 访问密钥 ID | 对象存储服务商 | 不能 | 证明你有权限访问 bucket |
| 访问密钥密码 | 对象存储服务商 | 不能 | 和访问密钥 ID 配套使用 |
| 同步密码 | 用户自己 | 可以 | 加密和解密同步数据 |

简单记忆：

```text
访问密钥 ID / 访问密钥密码：去阿里云 OSS、MinIO、R2、S3 等控制台创建。
同步密码：你自己设置，多台设备必须完全一样。
```

---

## 多设备和多用户隔离

同一个人的多台电脑：

```text
同步通道 / 仓库 ID 一样
同步密码一样
```

不同用户之间：

```text
同步通道 / 仓库 ID 必须不同
同步密码也应该不同
最好使用不同 bucket 或不同访问密钥
```

更详细的隔离逻辑见：

[多用户仓库隔离说明](docs/MULTI_USER_REPOSITORY_ISOLATION.md)

---

## 安全提醒

请务必注意：

- 不要把 `data.json` 发给别人。
- 不要把真实 AccessKey、Secret、同步密码提交到 GitHub。
- `AccessKey Secret` 通常只在创建时显示一次，忘记后只能重新创建。
- 忘记同步密码后，远端已加密数据无法直接用新密码解密。
- 商业化多用户场景不要长期让所有用户共用同一套 AccessKey。

商业化多用户方案见：

[商业化多用户 OSS 访问与隔离方案](docs/COMMERCIAL_MULTI_USER_OSS_ACCESS_PLAN.md)

---

## 文档

- [完整中文使用手册](OBSIDIAN_SYNC_PLUGIN_USER_MANUAL.md)
- [发给朋友的安装说明](FRIEND_INSTALL_AND_USE.md)
- [阿里云 OSS 配置与排查](docs/ALIYUN_OSS_SYNC_SETUP_AND_TROUBLESHOOTING.md)
- [多用户仓库隔离说明](docs/MULTI_USER_REPOSITORY_ISOLATION.md)
- [商业化多用户 OSS 访问方案](docs/COMMERCIAL_MULTI_USER_OSS_ACCESS_PLAN.md)
- [方案 B：后端 STS 临时凭证交接文档](docs/HANDOFF_COMMERCIAL_STS_PLAN_B.md)

---

## 当前状态

当前版本：

```text
0.1.0
```

已验证：

```text
12 个测试文件通过
91 条测试通过
构建成功
```

当前重点：

```text
个人自托管同步可用。
商业化 STS 临时凭证模式仍在规划 / 后续开发中。
```

---

## 开发

安装依赖：

```powershell
npm.cmd install
```

运行测试：

```powershell
npm.cmd test
```

构建：

```powershell
npm.cmd run build
```

---

## 项目定位

Obsidian E2EE Sync 的目标不是做一个封闭同步服务，而是提供一种可自托管、可审计、可扩展的同步方式：

```text
你的笔记
你的对象存储
你的同步密码
你的数据边界
```

如果你正在寻找一个“把 Obsidian 笔记加密后同步到自己云存储”的方案，可以从这里开始。
