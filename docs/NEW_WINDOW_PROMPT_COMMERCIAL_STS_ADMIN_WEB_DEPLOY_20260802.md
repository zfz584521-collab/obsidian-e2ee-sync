# 新窗口提示词：Commercial STS 管理员页面复核与部署

```text
继续 E:\project\Obsidian插件\同步功能 的商业 STS MVP。

先完整阅读：
- docs/HANDOFF_COMMERCIAL_STS_ADMIN_WEB_LOCAL_20260802.md
- docs/COMMERCIAL_STS_ADMIN_WEB.md
- docs/HANDOFF_COMMERCIAL_STS_ROTATION_VALIDATED_20260730.md
- docs/OBSIDIAN_REAL_TWO_DEVICE_ACCEPTANCE_20260730.md
- docs/COMMERCIAL_STS_BACKEND_CONTRACT.md
- docs/COMMERCIAL_STS_OPERATIONS_RUNBOOK.md

开始先运行：
- git status --short
- git log -1 --oneline
- git diff --check

当前本地状态：
- 管理员页面代码已实现，但尚未提交、推送或部署。
- 页面支持管理员登录、创建客户并一键签发、重新签发、续期、吊销、停用和恢复。
- 每位客户只保留一个当前有效令牌；令牌原文只显示一次，服务器只保存哈希。
- 已修复 JsonFileCommercialStore 旧内存覆盖外部新数据的问题。
- npm.cmd test 已通过 26 个测试文件、184 条测试。
- npm.cmd run build 已通过。
- SENSITIVE_FILE_CHECK=PASS。
- git diff --check 已通过。
- 本机没有 Docker，Compose 检查需在服务器部署前补做。
- 最新已提交版本仍为 a2f2700。

先复核管理员页面相关差异和测试，再运行：
- npm.cmd test
- npm.cmd run build
- git diff --check

未经我明确要求，不要提交或推送；如果我要求提交，只能精确暂存相关文件，不要使用 git add .。

服务器部署顺序：
1. 先以 ADMIN_ENABLED=false 部署代码并完成 Compose、构建、healthz 和 readyz 检查。
2. 管理员密码必须由我通过一次性本地安全输入页面设置；不要让我在终端来回输入，不要在聊天中索取或显示密码。
3. 密码安全安装后才能启用 ADMIN_ENABLED=true 并重建后端。
4. 验证 https://sync.e2note.com/admin 的登录、创建、一次性签发、续期、吊销、停用、恢复和重新签发。
5. 管理员页面部署后重新运行 BACKEND_STATE、HEALTH_STATUS、READY_STATUS、STS_STATUS、OSS_STATUS 五项验收，必须全部 PASS。
6. 最后才进入真实 Obsidian 双端验收。

重要服务器遗留风险：
- 2026-07-30 测试令牌曾出现在截图中，必须视为已暴露，不得继续使用。
- 服务器可能仍有 /3、旧 issued-stage-d-20260730.secret 和未确认的第二次测试签发对象。
- 上一次浏览器操作被站点权限策略阻止，不能假设重新签发、重启或清理已完成。
- 先做脱敏状态核查，不得读取令牌或 secret 内容；确认新流程可用后再精确删除旧临时文件和 /3。

永久安全边界：
- 不读取、输出、复制或提交 data.json、真实 .env*、.commercial-sts/、*.secret、AccessKey、Secret、SecurityToken、授权令牌、管理员密码、同步密码、设备 ID 或哈希盐。
- 不查看服务器 .env 内容，不查看或截图终端历史。
- 不要 reset、checkout、revert、覆盖或删除用户改动。
- 保留现有未跟踪的 .claude/、旧交接文档和 Word 文件。
- 不要使用 git add .。
- 未经我明确确认，不要修改 DNS、付款或执行真实 Obsidian 操作。
- 每个阶段结束运行 git diff --check。

请持续推进所有安全的本地工作；只有管理员密码输入、生产部署权限、DNS、付款和真实 Obsidian 操作才暂停，并用一句最简单的话告诉我在哪里操作。
```
