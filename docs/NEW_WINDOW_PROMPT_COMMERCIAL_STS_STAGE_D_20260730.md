# 新窗口提示词：商业 STS 阶段 D

把下面内容复制到新的 Codex 窗口：

```text
继续 E:\project\Obsidian插件\同步功能 的商业 STS MVP，只处理最后的阶段 D 与收尾。

先完整阅读：
- docs/HANDOFF_COMMERCIAL_STS_ROTATION_VALIDATED_20260730.md
- docs/OBSIDIAN_REAL_TWO_DEVICE_ACCEPTANCE_20260730.md
- docs/COMMERCIAL_STS_BACKEND_CONTRACT.md
- docs/COMMERCIAL_STS_OPERATIONS_RUNBOOK.md
- RELEASE_NOTES.md

开始先运行：
- git status --short
- git log -1 --oneline
- git diff --check

当前已完成：
- 阶段 E：25 个测试文件、176 条测试、构建、打包、敏感项检查和干净安装均通过。
- 发布包：release/obsidian-sync-plugin-0.1.1-commercial-sts-20260730-094309.zip
- SHA-256：1C7FBC17D3AFC2C6C898DB95EFA4EE9792A8201DE587AEFA6568DD1DA2BD575B
- 阶段 B：新凭证已安全轮换；旧凭证删除前后两轮五项验收全部通过；RAM 只保留一个启用的新 AccessKey。
- 阶段 C：sync.e2note.com 权威 DNS、TLS、公网 healthz/readyz、CORS 和未授权 401 验收通过。

现在只剩阶段 D：
1. 由我在两台真实 Obsidian 中安装同一个 0.1.1 发布包。
2. 两台都使用商业模式，授权服务地址为 https://sync.e2note.com。
3. 我只在 Obsidian 内输入真实授权令牌和同步密码，不在聊天中提供。
4. 第一台点击“复制第二台配置”，第二台点击“粘贴配置”；两台重新填写同一个授权令牌和完全相同的同步密码。
5. 按 docs/OBSIDIAN_REAL_TWO_DEVICE_ACCEPTANCE_20260730.md 完成 A->B、B->A、删除传播和重启复验。
6. 只有我明确报告全部真实操作通过，才能把阶段 D 标记为 PASS。

安全边界：
- 不读取、输出、复制或提交 data.json、.env*、.commercial-sts/、*.secret、AccessKey/Secret/SecurityToken、授权令牌、同步密码、设备 ID 或哈希盐。
- 不查看服务器 .env，不查看终端历史，不要求我在聊天中提供秘密。
- 不再修改 DNS、生产 AccessKey、STS/OSS 配置或已验证服务器，除非新的真实验收证据明确要求诊断。
- 不 reset、checkout、revert、覆盖或删除用户改动。
- 保留未跟踪的 .claude/、旧交接文档和 Word 文件。
- 不使用 git add .。

真实 Obsidian 操作必须由我完成；需要我操作时只用一句最简单的话告诉我在哪里操作。
如果我报告失败，先记录设备、阶段、脱敏错误类别和 HTTP 状态，再做最小诊断；不要读取或索要真实秘密。
阶段 D 结束后运行 git diff --check，并更新最终交接文档。
```
