# 商业 STS MVP 临时凭证跑通交接（2026-07-30）

## 1. 结论

商业 STS MVP 已使用现有临时 AccessKey 完成服务器内网真实闭环验收：

- `BACKEND_STATE=PASS`
- `HEALTH_STATUS=PASS`
- `READY_STATUS=PASS`
- `STS_STATUS=PASS`
- `OSS_STATUS=PASS`

其中 OSS 验收包含允许前缀的列举、写入、读取、删除、测试对象清理，以及跨前缀访问拒绝。

这证明当前部署、阿里云 STS `AssumeRole`、角色信任关系和 OSS 最小权限策略可以协同工作。它不等于正式生产安全闭环，原因见下文。

## 2. 当前安全状态

### 2.1 临时 AccessKey

当前服务器使用的是用户此前通过截图提供、目前仍启用的 AccessKey。该凭证已经出现在对话截图中，因此只能视为临时联调凭证。

必须遵守：

- 不在文档、聊天、命令、日志或 Git 中再次记录 AccessKey ID 或 Secret。
- 不读取或输出服务器 `.env` 内容。
- 在单独维护窗口完成无明文轮换后，才能把凭证安全项标记为正式完成。
- 在用户没有明确要求轮换时，不要再次变更当前唯一启用的 AccessKey，以免打断已跑通的服务。

轮换过程中曾删除一把较旧的启用密钥以释放槽位。最后通过 RAM IMS 查询确认：

- AccessKey 总数：1
- 启用 AccessKey 数：1

### 2.2 凭证写入方式

现有临时凭证通过一次性 RSA-OAEP-SHA256 加密通道写入服务器：

1. 服务器生成一次性 RSA 密钥对。
2. 浏览器侧只向云端传输密文。
3. 服务器解密后以 `600` 权限原子更新生产配置。
4. 后端容器强制重建。
5. 成功脚本通过退出清理删除一次性私钥、公钥和临时明文文件。

没有把凭证写入仓库文件，也没有提交或推送凭证。

## 3. 已验证事实

### 3.1 服务器

- 部署目录：`/opt/obsidian-e2ee-sync/deploy/commercial-sts`
- 后端容器处于运行且健康状态。
- 本机 `http://127.0.0.1:8788/healthz` 通过。
- 本机 `http://127.0.0.1:8788/readyz` 通过。

### 3.2 阿里云 STS

- 真实 `AssumeRole` 成功。
- 返回的临时凭证字段完整。
- 之前的 `AK_ID_INVALID` 阻塞已经由有效临时 AccessKey 排除。

### 3.3 OSS 权限

- 允许前缀列举通过。
- 测试对象写入、读取、删除通过。
- 跨租户前缀访问被拒绝。
- 测试对象清理完成。

### 3.4 Git

交接时基线：

- `HEAD`: `19d3074 Fix Aliyun STS RPC request signing`
- `git diff --check`: 通过

工作区还有与本次提交无关的未跟踪内容，必须保留：

- `.claude/`
- `docs/HANDOFF_COMMERCIAL_STS_SERVER_DEPLOY_20260726.md`
- 一份用户 Word 文档

不要使用 `git add .`，不要删除、覆盖、`reset`、`checkout` 或 `revert` 这些内容。

## 4. 尚未完成

以下事项不能因为服务器内网验收通过而宣称完成：

1. 截图已暴露临时 AccessKey 的安全轮换。
2. `sync.e2note.com` DNS 切换。
3. DNS 切换后的公网 HTTPS `/healthz` 和 `/readyz` 验收。
4. 真实 Obsidian 双端同步验收。
5. 商业版 `0.1.1` 的版本、测试、构建、打包、发布说明和干净安装联合验收。

未经用户明确确认，不得切换 `sync.e2note.com` DNS。

## 5. 后续最短计划

执行顺序固定为：

1. 阶段 A：保持当前可用状态。
2. 阶段 E：先完成不影响线上服务的本地发布闭环。
3. 阶段 B：完成安全轮换并重新验证。
4. 阶段 C：用户明确确认后切换 DNS。
5. 阶段 D：最后进行真实 Obsidian 双端验收。

即：**A → E → B → C → D**。

不能把阶段 C、D 放在阶段 B 前面：当前临时 AccessKey 已经出现在截图中，先开放公网和真实同步会让正式流量继续依赖已暴露凭证。阶段 E 可以提前，因为本地测试、构建和打包不需要改动线上密钥或 DNS。

### 阶段 A：保持当前可用状态

- 不修改当前唯一启用的临时 AccessKey。
- 不改 DNS。
- 不做与 STS MVP 无关的服务器改动。
- 如需诊断，只输出固定脱敏状态字段。

### 阶段 E：先完成本地版本发布闭环

- 更新或确认版本文件。
- 运行全部测试与构建。
- 生成发布包。
- 检查包内不含 `.env*`、`data.json`、`.commercial-sts/`、密钥或其他本地状态。
- 做干净安装验证。
- 更新发布说明。
- 每个步骤结束运行 `git diff --check`。
- 阶段 E 只能证明本地发布物就绪，不能代替阶段 B、C、D，也不能提前宣称正式生产发布完成。

### 阶段 B：随后完成安全轮换

在用户明确要求轮换时执行：

1. 创建一把从未显示在截图、聊天或终端历史中的新 AccessKey。
2. 通过一次性加密通道写入服务器。
3. 依次验证后端、`healthz`、`readyz`、真实 STS 和真实 OSS。
4. 五项全部通过后，停用并删除当前截图已暴露的临时 AccessKey。
5. 再运行一次五项验收，确认服务使用的是最终新凭证。
6. 最终确认 RAM 用户只保留预期的启用凭证。

如果新凭证验收失败，不得先删除当前可用凭证。

### 阶段 C：安全轮换后进行 DNS 与公网验收

仅在用户明确确认后：

1. 切换 `sync.e2note.com` DNS。
2. 等待解析生效。
3. 验证公网 HTTPS `/healthz=200/ok`。
4. 验证公网 HTTPS `/readyz=200/ready`。
5. 不通过时优先回滚 DNS，不改动已验证的 STS/OSS 配置。

### 阶段 D：最后进行真实 Obsidian 验收

需要用户在真实 Obsidian 中操作：

1. 两台设备连接同一商业同步仓库。
2. 验证新增、修改、删除和冲突处理。
3. 验证退出登录、令牌过期和重新授权。
4. 记录脱敏结果，不记录同步密码、令牌或设备 ID。

## 6. 新窗口提示词

```text
继续 E:\project\Obsidian插件\同步功能 的商业 STS MVP。

先完整阅读：
- docs/HANDOFF_COMMERCIAL_STS_TEMPORARY_KEY_VALIDATED_20260730.md
- docs/HANDOFF_COMMERCIAL_STS_SERVER_DEPLOY_20260726.md
- docs/HANDOFF_COMMERCIAL_STS_PRODUCTION_VALIDATED_20260717.md
- docs/COMMERCIAL_STS_BACKEND_CONTRACT.md
- docs/COMMERCIAL_STS_OPERATIONS_RUNBOOK.md

开始先运行：
- git status --short
- git log -1 --oneline
- git diff --check

当前已验证：
- BACKEND_STATE=PASS
- HEALTH_STATUS=PASS
- READY_STATUS=PASS
- STS_STATUS=PASS
- OSS_STATUS=PASS

后续执行顺序固定为：
1. 阶段 E：先完成本地测试、构建、打包、敏感文件检查和干净安装验证。
2. 阶段 B：再完成安全轮换，并在删除旧凭证前后各运行五项验收。
3. 阶段 C：我明确确认后才能切换 DNS，并进行公网 HTTPS 验收。
4. 阶段 D：最后由我进行真实 Obsidian 双端验收。

不要把阶段 C 或 D 提前到阶段 B 前面。阶段 E 可以现在直接持续推进，但它不能代替生产凭证轮换、DNS 或真实 Obsidian 验收。

重要：服务器当前使用的是截图已经暴露的临时 AccessKey，但服务已跑通。除非我明确要求“开始安全轮换”，否则不要修改或删除当前唯一启用的 AccessKey，不要为了追求最终状态打断现有可用服务。

安全轮换时必须先创建并加密安装新凭证，五项验收全部通过后才能删除旧凭证；删除旧凭证后再跑一次五项验收。任何时候都不要读取、输出、复制或提交 data.json、.env*、.commercial-sts/、*.secret、AccessKey/Secret/SecurityToken、令牌、同步密码、设备 ID 或哈希盐。不要查看服务器 .env 内容，不要用 VNC 截图查看终端历史。

不要 reset、checkout、revert、覆盖或删除用户改动。保留现有未跟踪的 .claude/、旧交接文档和 Word 文件。不要使用 git add .。

未经我明确确认，不要切换 sync.e2note.com DNS。真实 Obsidian 操作、DNS、付款和输入真实秘密时才暂停，并只用一句最简单的话告诉我在哪里操作。其他安全工作持续推进。每个阶段结束运行 git diff --check。
```
