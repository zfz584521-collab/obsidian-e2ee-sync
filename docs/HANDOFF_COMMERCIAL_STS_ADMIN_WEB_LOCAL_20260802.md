# Commercial STS 管理员页面本地实现交接（2026-08-02）

## 一、当前结论

商业 STS 客户授权管理员页面已经在本地实现并通过测试，但尚未提交、推送或部署到生产服务器。

计划中的生产入口：

```text
https://sync.e2note.com/admin
```

页面当前支持：

- 管理员密码登录；
- 创建客户并一键签发令牌；
- 原始令牌只在签发或重新签发时返回一次；
- 每位客户只保留一个当前有效令牌；
- 重新签发时自动吊销旧令牌；
- 续期、吊销、停用和恢复客户；
- 查看客户状态、设备占用、有效令牌数量和到期时间；
- 不在客户列表中显示令牌原文、设备 ID 或服务器秘密。

## 二、商业运营规则

- 一个客户账号对应一个当前有效授权令牌。
- 同一客户的多台 Obsidian 设备共用该授权令牌。
- 所有设备仍需填写同一个由客户自行设置的同步密码。
- 同步密码不会提交给授权服务器。
- 令牌原文丢失后不能找回，只能重新签发。
- 重新签发会立即使旧令牌失效。
- 客户停用后不能继续换取新的临时 OSS 凭证。

## 三、本地实现文件

新增：

- `scripts/commercial-sts-admin-web.mjs`
- `tests/commercialStsAdminWeb.test.ts`
- `docs/COMMERCIAL_STS_ADMIN_WEB.md`

修改：

- `scripts/commercial-sts-server.mjs`
- `scripts/commercial-sts-json-store.mjs`
- `scripts/commercial-sts-preflight.mjs`
- `tests/commercialStsServer.test.ts`
- `tests/commercialStsJsonStore.test.ts`
- `tests/commercialStsPreflight.test.ts`
- `deploy/commercial-sts/.env.example`
- `deploy/commercial-sts/README.md`
- `docs/COMMERCIAL_STS_OPERATIONS_RUNBOOK.md`
- `README.md`

## 四、安全设计

- 管理员页面默认关闭，只有 `ADMIN_ENABLED=true` 时才启用。
- 启用时要求独立管理员密码，至少 16 个字符。
- 管理员密码不能与同步密码、云账号密码、AccessKey 或其他密码复用。
- 登录成功后使用短时随机会话。
- Cookie 使用 `HttpOnly`、`Secure` 和 `SameSite=Strict`。
- 所有修改操作要求 CSRF 令牌。
- 登录失败有频率限制。
- 管理接口使用 `no-store`、禁止 iframe、禁止 MIME 猜测等安全响应头。
- 令牌原文只在创建或重新签发响应中出现一次；持久化文件只保存哈希。
- 管理员密码当前从服务器受限环境变量 `ADMIN_PASSWORD` 读取，任何自动化不得读取或输出其内容。

## 五、已修复的生产故障根因

此前通过运营 CLI 创建用户和令牌后，长时间运行的后端仍持有旧内存数据。下一次授权请求写审计日志时，旧内存状态可能重新覆盖磁盘，导致新用户消失并出现 `User not found`。

本次修改让 `JsonFileCommercialStore` 在读写前重新加载最新磁盘状态，覆盖以下场景：

- CLI 新建客户后，运行中的服务能立即读取；
- CLI 新签发令牌后，运行中的服务能立即验证；
- 服务写入审计日志时不会覆盖外部管理操作产生的新数据。

对应回归测试位于 `tests/commercialStsJsonStore.test.ts`。

## 六、本地验证证据

已通过：

```text
TEST_FILES=26
TESTS=184
TEST_STATUS=PASS
BUILD_STATUS=PASS
SENSITIVE_FILE_CHECK=PASS
DIFF_CHECK=PASS
```

执行过：

```powershell
npm.cmd test
npm.cmd run build
git diff --check
```

本机没有安装 Docker，因此没有执行本地 `docker compose config --quiet`。该项必须在生产部署前于服务器上补做。

## 七、Git 与工作树状态

交接编写前最后确认的提交：

```text
a2f2700 docs: hand off commercial STS stage D acceptance
```

管理员页面相关修改尚未提交、尚未推送。

必须继续保留且不得删除、覆盖或纳入无关提交：

- `.claude/`
- `docs/HANDOFF_COMMERCIAL_STS_SERVER_DEPLOY_20260726.md`
- 现有中文 Word 文件

禁止使用：

- `git reset`
- `git checkout --`
- `git revert`
- `git add .`

## 八、服务器与令牌遗留状态

生产 STS、OSS、DNS 和公网 HTTPS 此前已经验收通过，但真实 Obsidian 双端验收尚未完成。

2026-07-30 的测试令牌曾出现在用户截图中，必须视为已暴露，不得继续用于验收。

服务器可能仍存在以下临时对象，当前状态未重新验证：

- `/3` 临时数字入口；
- `issued-stage-d-20260730.secret`；
- 可能创建但未确认完成的第二次测试签发流程或文件；
- 阿里云命令助手中相关临时命令记录。

上一次浏览器操作被站点权限策略阻止，因此不能假设重新签发、重启或清理已经完成。下一窗口必须先做脱敏状态核查，不得读取这些文件内容。

只有在确认新管理员页面和新测试令牌可用后，才能删除旧测试令牌文件和临时入口；删除前必须解析准确目标，不得递归删除目录。

## 九、下一阶段固定顺序

### 1. 复核本地修改

先运行：

```powershell
git status --short
git log -1 --oneline
git diff --check
npm.cmd test
npm.cmd run build
```

检查管理员页面差异、安全响应头、管理员配置验证和持久化回归测试。

### 2. Git 检查点

未经用户明确要求不要提交或推送。用户确认后只能精确暂存管理员页面相关文件，检查：

```powershell
git diff --cached --name-status
git diff --cached --check
```

不得使用 `git add .`。

### 3. 生产部署准备

- 先以管理员页面默认关闭状态部署代码。
- 在服务器上运行 Compose 配置检查、构建和健康检查。
- 不读取服务器 `.env` 内容。
- 管理员密码由用户本人通过一次性本地安全输入页面设置，不要让用户在终端中来回输入，也不要在聊天中索取。
- 密码设置完成后才启用 `ADMIN_ENABLED=true` 并重建后端。

### 4. 管理员页面验收

依次验证：

1. 未登录访问管理 API 返回未授权；
2. 错误管理员密码被拒绝；
3. 正确登录成功；
4. 创建测试客户并一键签发；
5. 令牌只显示一次，列表中不出现原文；
6. 续期成功；
7. 停用和恢复成功；
8. 重新签发后旧令牌失效；
9. 吊销后令牌失效；
10. 删除或吊销全部测试授权和临时交付文件。

### 5. 五项生产验收

管理员页面部署后仍需重新运行：

```text
BACKEND_STATE
HEALTH_STATUS
READY_STATUS
STS_STATUS
OSS_STATUS
```

五项必须全部为 `PASS`。

### 6. 真实 Obsidian 双端验收

最后由用户在两台真实 Obsidian 中完成同一库双端同步。不得用本地单元测试或服务器健康检查代替。

## 十、永久安全边界

任何时候都不要读取、输出、复制或提交：

- `data.json`
- 真实 `.env` 文件
- `.commercial-sts/`
- `*.secret`
- AccessKey、Secret、SecurityToken
- 授权令牌
- 管理员密码
- 同步密码
- 设备 ID
- 哈希盐

不要查看服务器 `.env` 内容，不要通过截图查看终端历史，不要把令牌或管理员密码发到聊天中。