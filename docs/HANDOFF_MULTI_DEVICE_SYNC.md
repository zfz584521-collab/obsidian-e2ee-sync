# 多端同步开发交接文档

> 交接日期：2026-07-07  
> 项目路径：`E:\project\Obsidian插件\同步功能`  
> 当前目标：继续开发 Obsidian 同步插件，使其支持双端、多端同步，并逐步达到 Obsidian 社区插件市场发布质量。

## 1. 新窗口接手时先读这里

你要继续开发的是一个 Obsidian 第三方插件，主要功能是：

- 使用 S3 兼容对象存储作为远端。
- 当前已配置阿里云 OSS。
- 文件内容和事件日志端到端加密。
- 当前正在从“单端上传备份雏形”推进到“双端/多端同步产品”。

新窗口第一步不要直接重构。先执行：

```powershell
cd E:\project\Obsidian插件\同步功能
git status --short
npm.cmd test
npm.cmd run build
```

预期结果：

```text
Test Files  8 passed (8)
Tests       73 passed (73)
Build       success
```

## 2. 当前重要结论

之前审查发现：

- 旧版本只能上传本地变更。
- 远端拉取函数是 TODO。
- 本地索引启动时会扫描当前文件，导致首次同步无法把已有文件识别为待上传。
- 文件监听会提前更新本地索引，导致变更被误标记为已同步。
- 路径加密使用随机 IV，导致同一路径每次生成不同远端 key，多端无法定位同一个文件。

本轮已经修复或补上：

- 多端同步主流程。
- 稳定远端对象 key。
- 远端设备日志拉取。
- 远端变更应用。
- 删除事件处理。
- 冲突副本保护。
- 本地同步基线持久化。
- 当前设备注册到仓库元数据。
- 阿里云 OSS 兼容。
- Obsidian `requestUrl` 传输层。

但注意：

> 目前仍未完成真实双端测试。代码通过单元测试和构建，不等于已经达到市场发布质量。

## 3. 当前远端协议 v1

远端对象布局：

```text
content/<stablePathKey>
logs/<deviceId>/<clock>.json
meta/repo/<repoId>.json
```

说明：

- `content/<stablePathKey>` 保存加密后的文件内容。
- `logs/<deviceId>/<clock>.json` 保存加密后的设备事件。
- `meta/repo/<repoId>.json` 保存仓库元数据和设备列表。

`stablePathKey` 由同步密码、`repoId` 派生的 HMAC key 和文件路径生成：

- 同一仓库、同一密码、同一路径，多端生成相同 key。
- 服务端无法直接看到明文路径。
- 文件内容仍使用 AES-GCM 随机 IV 加密。

## 4. 当前同步流程

一次同步周期：

1. 检查配置。
2. 确保本地 `repoId` 存在。
3. 使用同步密码和 `repoId` 派生密钥。
4. 连接远端 OSS/S3。
5. 创建或更新仓库元数据。
6. 基于“上次成功同步基线”扫描本地变更。
7. 拉取其他设备尚未处理的事件日志。
8. 按路径折叠远端事件，只保留每个路径最新事件。
9. 应用远端变更。
10. 上传本地变更。
11. 写入本机事件日志。
12. 保存本地索引和设备 clock。
13. 完成同步。

冲突策略：

- 如果远端事件路径在本地也存在未同步变更，不覆盖本地文件。
- 远端版本保存为冲突副本。
- 冲突副本命名：

```text
原文件名 (冲突 <deviceId> <timestamp>).扩展名
```

## 5. 本轮新增和修改的文件

### 新增

```text
src/sync/ObsidianHttpHandler.ts
tests/obsidianHttpHandler.test.ts
docs/ALIYUN_OSS_SYNC_SETUP_AND_TROUBLESHOOTING.md
docs/MULTI_DEVICE_SYNC_AND_RELEASE_PLAN.md
docs/HANDOFF_MULTI_DEVICE_SYNC.md
```

### 修改

```text
main.ts
src/crypto/CryptoService.ts
src/sync/LocalIndex.ts
src/sync/RemoteStorage.ts
src/sync/SyncManager.ts
src/types/index.ts
src/utils/progress.ts
tests/crypto.test.ts
tests/remoteStorage.test.ts
docs/ROADMAP.md
```

### 不要误碰

```text
data.json
```

该文件包含本地配置、AccessKey、同步密码等敏感信息。不要输出、不要截图、不要提交。

`.claude/` 是已有未跟踪目录，不属于本轮同步功能代码改动。

## 6. 关键代码说明

### `src/crypto/CryptoService.ts`

新增：

```ts
getStablePathKey(path: string): Promise<string>
```

用途：

- 生成稳定远端 key。
- 解决随机路径加密导致多端找不到同一对象的问题。

### `src/sync/LocalIndex.ts`

改变语义：

- 旧：初始化时扫描当前文件并作为索引。
- 新：索引代表“上次成功同步基线”。

新增：

```ts
importIndex(entries)
```

### `main.ts`

文件变更监听现在只记录日志，不再更新 `localIndex`。

原因：

- 文件监听提前更新索引会让同步扫描看不到变更。

### `src/sync/RemoteStorage.ts`

保留并使用：

- 阿里云 OSS 虚拟主机寻址。
- Obsidian `requestUrl` 网络传输。

新增：

```ts
downloadLog(logKey: string): Promise<Uint8Array>
```

### `src/sync/SyncManager.ts`

本轮主改动。

新增能力：

- 读取持久化本地基线。
- 拉取远端设备事件。
- 折叠远端事件。
- 应用 create、modify、delete。
- 保存冲突副本。
- 保存本地同步基线。
- 更新远端设备 clock。
- 注册当前设备到仓库元数据。

### `src/utils/progress.ts`

新增：

```ts
updateRemoteClock(deviceId, clock)
getRemoteClock(deviceId)
```

用于每台远端设备增量拉取日志。

## 7. 当前验证结果

最后一次验证：

```powershell
npm.cmd test
npm.cmd run build
git diff --check
```

结果：

```text
Test Files  8 passed (8)
Tests       73 passed (73)
Build       success
diff check  pass
```

`git diff --check` 只出现 LF/CRLF 提示，不是语法错误。

## 8. 下一步优先任务

### P0：真实双端测试

必须先做，不要继续堆功能。

建议流程：

1. 办公电脑新建一个测试 Obsidian 仓库。
2. 配置当前插件。
3. 创建几个测试文件：

```text
test-a.md
folder/test-b.md
assets/test.txt
```

4. 办公电脑手动同步。
5. 家里电脑新建空仓库。
6. 安装同版本插件。
7. 使用同一 OSS 配置、同步密码和 repoId。
8. 家里电脑手动同步。
9. 检查文件是否下载。
10. 家里电脑修改 `test-a.md`，同步。
11. 办公电脑同步，检查修改是否拉回。
12. 双端同时改同一文件，检查是否产生冲突副本。
13. 删除文件，检查删除事件是否同步。

### P1：做真实测试夹具

现有测试多是单元测试和模拟测试。下一步应补：

- 假远端存储内存实现。
- 假 Obsidian vault。
- 双设备 SyncManager 集成测试。

目标场景：

- A 上传，B 下载。
- B 修改，A 下载。
- A/B 同时修改，生成冲突副本。
- A 删除，B 删除。
- B 本地有未同步修改时，A 删除不覆盖 B。

### P1：安全 UI

发布前必须：

- AccessKey Secret 输入框改成密码框。
- 同步密码输入框改成密码框。
- 不在日志中输出敏感字段。
- 设置页增加“复制 repoId”按钮。
- 配置导出默认不包含 Secret 和同步密码。

### P2：插件市场准备

必须完成：

- 修复 `manifest.json` 中文乱码。
- 完善 README。
- 完善用户指南。
- 完善 `versions.json`。
- GitHub Release 打包 `main.js`、`manifest.json`、`styles.css`。
- tag 与 manifest version 一致。
- 用 BRAT 或手动安装做小范围测试。
- 提交到 `obsidianmd/obsidian-releases`。

## 9. 新窗口可以直接发的提示词

建议在新窗口粘贴下面这段：

```text
继续开发 E:\project\Obsidian插件\同步功能 这个 Obsidian 同步插件。

请先阅读：
1. docs/HANDOFF_MULTI_DEVICE_SYNC.md
2. docs/MULTI_DEVICE_SYNC_AND_RELEASE_PLAN.md
3. src/sync/SyncManager.ts
4. src/crypto/CryptoService.ts

当前目标：继续把多端同步做成可发布产品。先不要大重构，先验证并补齐双设备同步测试。

请先运行：
git status --short
npm.cmd test
npm.cmd run build

注意：
- data.json 含密钥和同步密码，不要输出、不提交。
- 当前多端同步 v1 已实现，但还没有真实双端测试。
- 优先补双设备集成测试，验证 A 上传 B 下载、B 修改 A 下载、冲突副本、删除传播。
```

## 10. 家里电脑测试注意事项

不要一开始用家里已有的大型 Obsidian 仓库。

推荐：

1. 先新建空仓库。
2. 先关闭自动同步。
3. 只做手动同步。
4. 每一步同步前都备份。
5. 观察冲突副本。
6. 确认稳定后再考虑接入真实仓库。

必须相同：

- Endpoint
- Bucket
- Region
- AccessKey
- SecretKey
- 同步密码
- repoId

必须不同：

- deviceId
- 设备名称

## 11. 已知风险

- `data.json` 明文存储敏感配置。
- 还没有真实双端测试。
- 还没有假 vault 双设备集成测试。
- 冲突解决只有“保存副本”，没有 UI 合并。
- 删除事件需要更多真实验证。
- 不是 CRDT，不支持段落级自动合并。
- 移动端未验证。
- 其他 S3 服务商未回归。

## 12. 参考文档

- `docs/MULTI_DEVICE_SYNC_AND_RELEASE_PLAN.md`
- `docs/ALIYUN_OSS_SYNC_SETUP_AND_TROUBLESHOOTING.md`
- `docs/ROADMAP.md`
- `docs/SETUP.md`
- `docs/API.md`

---

## 2026-07-08 继续开发交接更新

请优先阅读新的当日交接文档：

- `docs/HANDOFF_2026-07-08_CONTINUE_RELEASE.md`

本轮新增和加固：

- 新增 `tests/syncManager.multiDevice.test.ts`，覆盖双设备同步主路径、多用户隔离、删除保护、旧布局阻断。
- 新增 `tests/configExporter.test.ts`，覆盖配置导出不泄露 Secret/同步密码/deviceId。
- 远端对象布局已改为 repo 命名空间：

```text
<storagePrefix>/repos/<repoId>/content/<stablePathKey>
<storagePrefix>/repos/<repoId>/logs/<deviceId>/<clock>.json
<storagePrefix>/repos/<repoId>/meta/repo.json
```

- `storagePrefix` 为可选通道前缀，用于同一个 bucket 中隔离不同用户、团队或测试环境。
- 如果发现旧布局 `meta/repo/<repoId>.json`，同步返回 `REMOTE_LAYOUT_MIGRATION_REQUIRED`，避免静默创建空的新仓库。
- 设置页已增加同步通道前缀，Secret Key 和同步密码已改为密码框。
- 配置导出保留 `repoId/storagePrefix`，不导出 AccessKey、SecretKey、同步密码、deviceId。

当前验证结果：

```text
npm.cmd test        10 passed, 82 passed
npm.cmd run build   success
git diff --check    仅 LF/CRLF 警告，无空白错误
```

新窗口继续任务：

1. 先运行 `git status --short`、`npm.cmd test`、`npm.cmd run build`。
2. 不要读取、输出、提交 `data.json`。
3. 下一步优先实现设置页的远端布局检测入口。
4. 然后实现旧布局迁移或重新初始化的明确用户操作。
5. 再做第二设备配置复制入口，不包含 Secret、同步密码、deviceId。
