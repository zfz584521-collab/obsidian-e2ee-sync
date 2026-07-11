# Obsidian 同步插件交接文档（2026-07-08）

> 项目路径：`E:\project\Obsidian插件\同步功能`
> 当前目标：继续把多端同步做成可发布产品。优先完成多用户隔离、真实双端验证、旧布局迁移提示、安全设置与市场发布准备。

## 新窗口先做什么

在新 Codex 窗口中先执行：

```powershell
cd E:\project\Obsidian插件\同步功能
git status --short
npm.cmd test
npm.cmd run build
```

注意：

- 不要读取、输出、提交 `data.json`。它可能包含 AccessKey、SecretKey、同步密码等敏感信息。
- 当前工作区有多处未提交修改，不要回滚用户或前序开发留下的改动。
- 先继续做小步验证和加固，不要大重构。

## 必读文件

1. `docs/HANDOFF_2026-07-08_CONTINUE_RELEASE.md`
2. `docs/HANDOFF_MULTI_DEVICE_SYNC.md`
3. `docs/MULTI_DEVICE_SYNC_AND_RELEASE_PLAN.md`
4. `src/sync/SyncManager.ts`
5. `src/sync/RemoteStorage.ts`
6. `src/crypto/CryptoService.ts`
7. `tests/syncManager.multiDevice.test.ts`

## 当前已完成

多端同步 v1 主流程已经实现并通过内存双设备集成测试：

- A 上传，B 下载。
- B 修改，A 下载。
- A/B 并发修改同一路径，保留本地文件并生成冲突副本。
- A 删除，B 删除。
- A 删除时，如果 B 本地有未同步修改，B 不删除本地文件，只计为冲突。
- 不同 `repoId` 在同一个 bucket / remote 下互不串数据。
- 配置导出不包含 AccessKey、SecretKey、同步密码、deviceId。
- Secret Key 和同步密码输入框已改为密码框。

当前远端命名空间已经加固为：

```text
<storagePrefix>/repos/<repoId>/content/<stablePathKey>
<storagePrefix>/repos/<repoId>/logs/<deviceId>/<clock>.json
<storagePrefix>/repos/<repoId>/meta/repo.json
```

其中 `storagePrefix` 可选，用于同一个 bucket 下隔离不同用户、团队或测试环境。

旧布局为：

```text
content/<stablePathKey>
logs/<deviceId>/<clock>.json
meta/repo/<repoId>.json
```

现在如果发现旧布局元数据，会返回 `REMOTE_LAYOUT_MIGRATION_REQUIRED`，避免静默创建一个空的新仓库。

## 当前验证结果

最后一次验证：

```text
npm.cmd test        10 passed, 82 passed
npm.cmd run build   success
git diff --check    仅 LF/CRLF 警告，无空白错误
```

## 原则性结论：10 人多设备隔离

如果 10 个人每人至少 2 台电脑，可以安全使用同一个插件，但必须满足：

- 每个人使用不同 `repoId`，或不同 `storagePrefix`。
- 同一个人的多台电脑使用相同 `repoId`、相同同步密码、相同对象存储配置。
- 同一个人的不同设备必须使用不同 `deviceId`。
- 配置导出给第二台电脑时不能复制 `deviceId`，当前已改为不导出。

这样即使多个用户共用同一个 bucket，也不会互相扫描日志、下载内容、传播删除。

## 下一步优先级

### P0：真实迁移/重新初始化入口

现在代码能检测旧布局，但还缺用户可操作入口。下一步建议：

1. 设置页增加“检测远端布局”按钮。
2. 如果检测到旧布局，给出两个明确选项：
   - 使用新的 `repoId/storagePrefix` 重新初始化。
   - 迁移旧远端数据到新命名空间。
3. 迁移必须是非破坏性的：复制旧对象到新路径，不删除旧对象。
4. 迁移前必须提示用户备份 vault 和对象存储。

### P0：真实双端手工验证

用小型空 vault，不要直接接入真实大库：

1. A 端创建 `test-a.md`、`folder/test-b.md`、`assets/test.txt`。
2. A 手动同步。
3. B 空 vault 使用同一个 `repoId`、同一个同步密码、同一个对象存储配置。
4. B 手动同步，确认文件下载。
5. B 修改 `test-a.md`，同步；A 同步，确认修改拉回。
6. A/B 同时改同一文件，确认冲突副本。
7. A 删除文件，确认 B 删除。
8. A 删除文件时 B 本地先改同一文件，确认 B 不被删除。

### P1：发布前安全和体验

1. 设置页显示当前 `repoId` 和 `storagePrefix`，提供复制按钮。
2. 增加“复制第二设备配置”按钮：导出 endpoint、bucket、region、storagePrefix、repoId，不导出 Secret、同步密码、deviceId。
3. 增加配置检查器：缺少 endpoint/bucket/secret/password/repoId 时明确提示。
4. 增加日志脱敏检查，避免输出 key、secret、password。
5. 增加冲突列表 UI。
6. 增加同步日志 UI。

### P2：市场发布准备

1. 修正 `manifest.json` 中的乱码、作者、描述、版本。
2. 完善 README：安装、配置、安全模型、隐私边界、故障排查。
3. 完善 `versions.json`。
4. GitHub Release 打包 `main.js`、`manifest.json`、可选 `styles.css`。
5. Release tag 必须与 `manifest.json` version 一致。
6. 通过 BRAT 或手动安装做小范围 beta。
7. 准备提交 `obsidianmd/obsidian-releases`。

## 新窗口可直接使用的提示词

```text
继续开发 E:\project\Obsidian插件\同步功能 这个 Obsidian 同步插件。

请先阅读：
1. docs/HANDOFF_2026-07-08_CONTINUE_RELEASE.md
2. docs/HANDOFF_MULTI_DEVICE_SYNC.md
3. docs/MULTI_DEVICE_SYNC_AND_RELEASE_PLAN.md
4. src/sync/SyncManager.ts
5. src/sync/RemoteStorage.ts
6. tests/syncManager.multiDevice.test.ts

请先运行：
git status --short
npm.cmd test
npm.cmd run build

注意：
- data.json 含密钥和同步密码，不要读取、输出、提交。
- 当前已完成内存双设备集成测试、多 repo 隔离、旧布局检测、安全导出和密码框加固。
- 当前验证结果是 10 个测试文件、82 条测试通过，构建成功。
- 下一步优先做：设置页远端布局检测入口、旧布局迁移/重新初始化操作、第二设备配置复制入口。
- 继续小步提交式开发，不要大重构。
```
