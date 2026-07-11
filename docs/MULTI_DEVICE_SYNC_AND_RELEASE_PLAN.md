# 多端同步协议与插件市场发布计划

> 日期：2026-07-07  
> 当前版本：0.1.0  
> 目标：把当前个人同步插件推进为可用于双端、多端，并具备提交 Obsidian 社区插件市场条件的产品。

## 当前开发结论

本轮开发将插件从“单端上传备份雏形”推进到“可重放远端事件的多端同步 v1”。

已完成：

- 稳定远端对象 key：同一路径在多端会生成同一个远端 key。
- 事件日志拉取：新设备可以读取其他设备上传的事件日志。
- 远端变更应用：其他设备的 create、modify、delete 事件可应用到本地。
- 冲突保护：本地与远端同一路径都有未同步变更时，不覆盖本地文件，而是保存冲突副本。
- 本地同步基线持久化：本地索引代表“上次成功同步状态”，不再被文件监听提前覆盖。
- 设备注册：同步时会把当前设备写入仓库元数据，供其他设备发现日志。
- 阿里云 OSS 兼容：虚拟主机寻址和 Obsidian `requestUrl` 传输层已保留。

仍需继续验证：

- 两台真实电脑之间的首次同步。
- 多台设备连续修改同一路径时的冲突体验。
- 删除事件在真实 Obsidian 仓库中的用户体验。
- 移动端网络和后台限制。
- 大文件、附件、图片、PDF 等二进制文件端到端同步。

## v1 同步协议

### 远端对象布局

```text
content/<stablePathKey>
logs/<deviceId>/<clock>.json
meta/repo/<repoId>.json
```

### `content/<stablePathKey>`

保存文件内容的加密包。

特点：

- `stablePathKey` 由同步密码、仓库盐值和文件路径通过 HMAC 生成。
- 服务端看不到明文路径。
- 同一路径在多台设备上得到同一个 key。
- 文件内容仍使用 AES-GCM 随机 IV 加密，每次上传密文不同。

### `logs/<deviceId>/<clock>.json`

保存设备事件日志。

每个事件日志本身也经过端到端加密。解密后包含：

```ts
interface SyncEvent {
  id: string;
  deviceId: string;
  clock: number;
  type: 'create' | 'modify' | 'delete' | 'move';
  path: string;
  remoteKey?: string;
  contentHash?: string;
  size?: number;
  mtime?: number;
  oldPath?: string;
  parentId: string;
  timestamp: number;
}
```

### `meta/repo/<repoId>.json`

保存仓库元数据。

当前包含：

- 仓库 ID
- 协议版本
- 创建时间
- 设备列表
- 保留策略

设备列表用于发现需要拉取哪些 `logs/<deviceId>/`。

## 同步流程

一次同步周期按以下顺序执行：

1. 检查配置。
2. 确保本地 `repoId` 已存在。
3. 使用同步密码和 `repoId` 派生加密密钥。
4. 连接远端对象存储。
5. 创建或更新仓库元数据。
6. 基于本地同步基线扫描本地变更。
7. 拉取其他设备尚未处理的事件日志。
8. 按路径折叠远端事件，只保留每个路径最新事件。
9. 应用远端变更。
10. 上传本地变更。
11. 写入本机事件日志。
12. 保存本地索引和设备 clock。
13. 完成同步。

## 冲突策略

v1 采用保守策略：

- 如果远端变更路径在本地也有未同步变更，则不覆盖本地文件。
- 远端版本会保存为冲突副本。
- 冲突副本命名格式：

```text
原文件名 (冲突 <deviceId> <timestamp>).扩展名
```

示例：

```text
项目计划 (冲突 dev_abcd1234 2026-07-07T11-20-30-000Z).md
```

这样可以最大限度避免用户误丢数据。

## 家里电脑接入建议

在真实双端验证完成前，推荐流程：

1. 办公电脑先备份当前 Obsidian 仓库。
2. 办公电脑执行一次手动同步。
3. 家里电脑新建一个空 Obsidian 仓库。
4. 安装同版本插件。
5. 填写同一套对象存储配置。
6. 填写完全相同的同步密码。
7. 使用同一个 `repoId`。
8. 设备名称填写不同值，例如“家里电脑”。
9. 保持自动同步关闭。
10. 先点击“测试连接”。
11. 再点击一次“同步”。
12. 确认文件可以从远端下载到家里电脑。
13. 再做少量双向修改测试。

不要一开始就把家里已有的大型笔记库直接接入同一远端仓库。

## 风险清单

### 数据风险

- v1 不是 CRDT，不做段落级自动合并。
- 同一路径双端同时修改会产生冲突副本，需要用户手动合并。
- 删除事件会传播到其他设备；虽然本地有未同步变更时会跳过删除，但仍需谨慎。
- 如果本地同步基线丢失，下一次同步可能把大量文件识别为新建。

### 安全风险

- 当前 `data.json` 明文保存 AccessKey 和同步密码。
- Secret 输入框仍不是密码框。
- 配置导入导出仍需进一步安全审计。
- 日志和错误提示必须持续避免输出凭据。

### 兼容风险

- 阿里云 OSS 已适配。
- AWS S3、Cloudflare R2、MinIO 仍需回归测试。
- 移动端需要单独测试 `requestUrl`、后台运行和系统杀进程行为。

## 上插件市场前必须完成

### 协议与功能

- [ ] 双端真实同步测试。
- [ ] 三端真实同步测试。
- [ ] 空仓库首次下载测试。
- [ ] 已有仓库接入安全测试。
- [ ] 冲突副本测试。
- [ ] 删除传播测试。
- [ ] 大文件分块上传和下载测试。
- [ ] 图片、PDF、附件同步测试。
- [ ] 移动端测试。
- [ ] 错误恢复和重试测试。

### 安全

- [ ] AccessKey Secret 输入框改为密码输入。
- [ ] 同步密码输入框改为密码输入。
- [ ] 不在日志中输出敏感字段。
- [ ] 明确提示用户不要同步 `.obsidian`、`data.json`、插件目录。
- [ ] README 中加入安全模型说明。
- [ ] README 中说明服务端只能看到加密对象和设备元数据。

### 用户体验

- [ ] 首次设置向导。
- [ ] 配置检查器。
- [ ] 一键复制第二设备配置，但不包含 Secret 和同步密码。
- [ ] 冲突列表 UI。
- [ ] 同步日志 UI。
- [ ] 同步状态面板完善。
- [ ] 明确的“自动同步”说明。

### 发布工程

- [ ] 修正 `manifest.json` 中文乱码。
- [ ] `manifest.json` 的 `id`、`name`、`description`、`author` 完整。
- [ ] 更新 `versions.json`。
- [ ] 建立 GitHub 仓库。
- [ ] 建立 GitHub Release。
- [ ] Release tag 与 `manifest.json` 中 version 一致。
- [ ] Release 附带 `main.js`、`manifest.json`、`styles.css`。
- [ ] README 提供安装、配置、故障排查和安全说明。
- [ ] 提交到 `obsidianmd/obsidian-releases`。

## Obsidian 社区插件发布要点

根据 `obsidianmd/obsidian-releases` 仓库说明，社区插件的分发机制如下：

- Obsidian 读取 `community-plugins.json` 中的插件列表。
- 插件详情页会从 GitHub 仓库读取 `manifest.json` 和 `README.md`。
- 实际安装文件来自 GitHub Release。
- Release tag 必须与 `manifest.json` 中的版本号一致。
- 安装时会下载 `manifest.json`、`main.js`，以及可选的 `styles.css`。
- 如果当前 Obsidian 版本低于插件要求的 `minAppVersion`，会参考 `versions.json` 查找兼容版本。

## 建议开发顺序

### Phase 1：多端核心验证

1. 在空测试仓库验证办公室电脑 → 家里电脑下载。
2. 验证家里电脑修改 → 办公室电脑下载。
3. 验证双端同名文件冲突副本。
4. 验证删除事件。
5. 修复真实测试中出现的问题。

### Phase 2：安全与设置体验

1. Secret 字段改密码框。
2. 同步密码改密码框。
3. 配置导出只导出非敏感字段。
4. 新设备配置导入保留 `repoId`。
5. 设置页展示当前 `repoId`，提供复制按钮。

### Phase 3：市场化准备

1. README 重写。
2. 用户指南重写。
3. 发布清单补齐。
4. GitHub Actions 打包 Release。
5. 邀请少量用户通过 BRAT 测试。
6. 修复反馈后提交社区插件。

## 当前验证命令

```bash
npm test
npm run build
```

当前结果：

```text
Test Files  8 passed (8)
Tests       73 passed (73)
Build       success
```

---

## 2026-07-08 状态更新

新增交接入口：`docs/HANDOFF_2026-07-08_CONTINUE_RELEASE.md`。

本轮已完成：

- 增加双设备内存集成测试：A 上传 B 下载、B 修改 A 下载、并发冲突副本、删除传播。
- 增加删除保护测试：A 删除时，如果 B 本地有未同步修改，B 不删除本地文件，只计为冲突。
- 远端对象改为按仓库命名空间隔离：

```text
<storagePrefix>/repos/<repoId>/content/<stablePathKey>
<storagePrefix>/repos/<repoId>/logs/<deviceId>/<clock>.json
<storagePrefix>/repos/<repoId>/meta/repo.json
```

- 增加多用户隔离测试：同一个远端、同一个 bucket、不同 `repoId` 不互相拉取、覆盖或删除。
- 增加旧布局检测：如果发现旧版 `meta/repo/<repoId>.json`，同步会返回 `REMOTE_LAYOUT_MIGRATION_REQUIRED`，避免静默创建空的新仓库。
- 设置页增加 `storagePrefix`，用于同 bucket 下隔离通道。
- Secret Key 和同步密码输入框已改为密码框。
- 配置导出保留 `repoId/storagePrefix`，但不导出 AccessKey、SecretKey、同步密码、deviceId。

当前验证：

```text
npm.cmd test        10 passed, 82 passed
npm.cmd run build   success
git diff --check    仅 LF/CRLF 警告，无空白错误
```

下一步优先：

1. 设置页增加“检测远端布局”按钮。
2. 检测到旧布局时提供“使用新 repoId/storagePrefix 重新初始化”或“迁移旧远端数据”的明确入口。
3. 增加第二设备配置复制入口：不包含 Secret、同步密码、deviceId。
4. 开始小型真实双端手工测试。
