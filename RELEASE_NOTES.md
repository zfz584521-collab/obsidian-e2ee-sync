# 发布说明

## v0.1.1 (2026-07-17)

### 商业 STS MVP

本版本在保留个人 static AccessKey 模式的基础上，新增商业授权服务模式。商业模式下，用户不需要填写长期 AccessKey，只需要填写授权服务地址、授权令牌和同步密码，插件会自动获取短期 OSS 临时凭证并完成端到端加密同步。

### 主要变化

- 新增 `static` / `sts` 双凭证模式。
- 新增 STS 临时凭证获取、缓存和临近过期刷新。
- 新增 SecurityToken 注入 S3/OSS 客户端。
- 新增商业授权服务 mock、最小后端骨架、运营 CLI、Docker Compose + Caddy 部署示例。
- 新增阿里云 STS/OSS 脱敏预检和冒烟测试脚本。
- 修复商业 STS 最小权限下测试连接误用 HeadBucket 导致的连接失败。
- 改进授权失败、限流、超时和网络异常的中文用户提示。
- 新增 `list-users`、`support-report`、`renewal-report`、`update-user`、`extend-token-hash`、`audit-summary`、`verify-store`、`backup-manifest` 运营命令，覆盖脱敏用户清单、脱敏客服报告、续费提醒、套餐/设备额度调整、按 token hash 续期、审计汇总、持久化存储只读校验和不含存储路径或内容的备份校验清单。
- 新增 `npm.cmd run package` 发布打包流程，自动生成安装 zip 并校验包内条目。
- 审计日志改为白名单字段，避免误写入笔记内容、文件路径或云端原始响应体。

### 安装

安装包包含：

- `main.js`
- `manifest.json`
- `styles.css`
- `OBSIDIAN_SYNC_PLUGIN_USER_MANUAL.md`

将以上文件放入 `.obsidian/plugins/obsidian-sync-plugin/` 后启用插件。

### 升级说明

从 `0.1.0` 或 `0.1.0-commercial-sts-fix` 升级到 `0.1.1` 时，覆盖插件目录中的 `main.js`、`manifest.json`、`styles.css` 和用户手册即可。不要删除或覆盖 Obsidian 插件目录中的 `data.json`。

个人 static AccessKey 模式配置会保留。商业 STS 模式配置同样会保留，但临时凭证只在运行时使用，不需要手工迁移。

### 回滚说明

如需回滚，先退出 Obsidian，再用上一版安装包覆盖 `main.js`、`manifest.json` 和 `styles.css`。保留 `data.json` 可继续使用原有配置。

如果已经切换到商业 STS 模式并回滚到不支持 STS 的版本，需要在旧版界面中重新填写个人 static AccessKey 配置，或恢复回滚前备份的配置。

### 验证结果

- `npm.cmd test`：24 个测试文件、169 条测试通过。
- `npm.cmd run build`：通过。
- `npm.cmd run package`：通过，生成 0.1.1 安装 zip。
- `git diff --check`：通过，仅有 Windows 换行提示。
- 真实环境已完成 HTTPS、CORS、401、STS 签发、OSS 前缀 CRUD、跨租户拒绝和双库双向同步闭环验证。

## v0.1.0 (2026-06-10)

### 首次发布

Obsidian 同步插件首次发布！一个功能完整的跨设备端到端加密同步解决方案。

### 核心功能

#### 🔒 端到端加密
- AES-256-GCM 内容加密
- PBKDF2-SHA256 密钥派生（200,000 次迭代）
- 文件名加密保护隐私
- SHA-256 内容哈希校验

#### 🌐 S3 兼容存储
- 支持 AWS S3、Cloudflare R2、MinIO 等
- 大文件自动分块上传
- 断点续传支持

#### 🔄 同步功能
- 本地文件索引和变更检测
- 增量同步优化
- 并发上传/下载
- 冲突检测和副本创建
- 选择性同步规则
- 多仓库支持

#### 📱 移动端支持
- 响应式 UI 适配
- WiFi 下自动同步
- 低电量暂停同步
- 触摸手势优化

#### 📊 统计和日志
- 同步历史统计
- 每日同步报表
- 详细操作日志
- 版本历史浏览

#### 🛡️ 健壮性
- 自动重试机制
- 指数退避策略
- 统一错误处理
- 离线队列管理

### 已知限制

- 不支持实时协作编辑
- 移动端后台同步受系统限制
- 版本历史功能需要 S3 版本控制支持
- 大型仓库首次同步可能较慢

### 系统要求

- Obsidian 1.0.0+
- S3 兼容存储服务账号
- 网络连接

### 安装

1. 下载 `main.js`、`manifest.json`、`styles.css`
2. 放入 `.obsidian/plugins/obsidian-sync-plugin/`
3. 启用插件

### 升级指南

此为首次发布，无需升级。

### 贡献者

感谢所有贡献者的付出！

### 反馈

- GitHub Issues: 提交问题和建议
- 查看 [用户手册](docs/USER_GUIDE.md) 了解使用方法

---

## 后续版本计划

### v0.2.0 (计划中)
- [ ] 实时同步状态同步
- [ ] 文件压缩优化
- [ ] 更丰富的统计图表
- [ ] 国际化支持

### v0.3.0 (计划中)
- [ ] 团队协作功能
- [ ] 端到端加密分享
- [ ] 增量同步优化

---

**完整更新日志**: 查看 [CHANGELOG.md](CHANGELOG.md)
