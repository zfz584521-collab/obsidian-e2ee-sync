# 更新日志

本项目的所有重要变更都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

## [0.1.1] - 2026-07-17

### 新增

- 商业 STS 授权模式：用户只填写授权服务地址、授权令牌和同步密码，插件从授权服务获取短期 OSS 临时凭证。
- 保留个人 static AccessKey 模式，已有个人配置可继续使用。
- 商业授权服务骨架：本地 mock、最小 JSON store、运营 CLI、健康检查、限流、Docker Compose + Caddy 部署示例。
- 阿里云 STS 与 OSS 脱敏联调脚本：支持 AssumeRole 冒烟测试、OSS 前缀 List/Put/Get/Delete 验证和跨租户拒绝验证。
- 多设备仓库命名空间隔离：远端对象进入 `storagePrefix/repos/{repoId}/`，降低跨仓库串数据风险。
- 运营 CLI 补充：支持 `list-users` 脱敏用户清单、`support-report` 脱敏客服报告、`renewal-report` 续费提醒、`update-user` 调整套餐与设备额度、`extend-token-hash` 按 token hash 续期、`audit-summary` 输出脱敏审计汇总、`verify-store` 做持久化存储只读校验、`backup-manifest` 生成不含内容或路径的备份校验清单。
- 发布打包工具：`npm.cmd run package` 会构建、生成发布 zip，并校验包内只有 `main.js`、`manifest.json`、`styles.css` 和用户手册。
- 无凭证部署验收命令：`npm.cmd run check:commercial-sts` 只检查 `/healthz`、`/readyz` 的状态和白名单元数据，不输出 URL、令牌或响应体。

### 修复

- 商业 STS 模式下测试连接改用精确 repo 前缀 ListObjectsV2 探测，避免最小权限模型下 HeadBucket 返回 403 导致 UnknownError。
- 授权服务 401、403、429、502、超时和网络异常映射为安全中文提示，不透传原始后端错误文本；STS 上游签发失败会记录 `provider_error` / `502` 脱敏审计事件。

### 安全

- 配置导出会过滤 AccessKey、Secret、SecurityToken、授权令牌、同步密码和设备 ID。
- 后端示例只保存 token/device hash，审计日志使用白名单字段，避免记录明文敏感信息、笔记内容、文件路径或云端原始响应体。
- `.gitignore` 增加 `data.json`、`.commercial-sts/`、`*.secret`、`.env*` 和账号信息文件保护。

### 验证

- 25 个测试文件、176 条测试通过。
- 生产构建通过。
- `npm.cmd run package` 生成 `obsidian-sync-plugin-0.1.1-commercial-sts-20260730-094309.zip`，包内仅包含四个安装文件。
- 已在空白插件目录完成解压安装校验：插件 ID、版本、最低 Obsidian 版本、文件 SHA-256 和 `main.js` 语法均通过。
- 生产 AccessKey 已通过一次性密文流程完成安全轮换；删除旧凭证前后两轮后端、`healthz`、`readyz`、真实 STS 和真实 OSS 五项验收均通过。
- `sync.e2note.com` 权威解析、公网 TLS、`/healthz`、`/readyz`、CORS 和未授权 `401` 验收通过。
- 本轮只剩阶段 D 的真实 Obsidian 双端同步验收，不能用接口或历史联调结果代替。

## [0.1.0] - 2026-06-10

### 新增

- 🔒 端到端加密功能
  - AES-256-GCM 内容加密
  - 文件路径加密
  - PBKDF2-SHA256 密钥派生（200,000 次迭代）
  - SHA-256 内容哈希校验

- 🌐 S3 兼容存储支持
  - AWS S3
  - Cloudflare R2
  - MinIO
  - 其他 S3 兼容服务

- 🔄 同步功能
  - 本地文件索引和变更检测
  - 加密上传/下载
  - 冲突检测和副本创建
  - 设备事件日志

- 🚀 大文件支持
  - 自动分块上传（>5MB）
  - 断点续传准备

- 🛡️ 健壮性
  - 自动重试机制（指数退避 + 抖动）
  - 统一错误处理
  - 同步状态管理

- 🎨 用户界面
  - 中文设置面板
  - 状态栏图标
  - 同步命令

- 🧪 测试
  - 47 个单元测试
  - Vitest 测试框架
  - 测试覆盖率报告

- 📚 文档
  - README
  - 快速开始指南
  - API 文档

### 安全

- 所有数据上传前端到端加密
- 密码仅存本地，不上传服务器
- 文件名加密，防止元数据泄露

### 已知问题

- 不支持选择性同步文件夹
- 不支持版本历史浏览
- 移动端后台同步受限

## 计划功能

- [ ] 选择性同步
- [ ] 版本历史浏览
- [ ] 文件恢复功能
- [ ] 同步状态详情面板
- [ ] 性能优化（增量同步、并发控制）
- [ ] 多仓库支持

---

## 版本命名规则

- **主版本号**：重大架构变更或不兼容更新
- **次版本号**：新功能添加
- **修订号**：Bug 修复和小改进
