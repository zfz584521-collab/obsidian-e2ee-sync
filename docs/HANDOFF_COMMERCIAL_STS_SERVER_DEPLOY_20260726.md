# 商业 STS 服务器部署交接（2026-07-26）

## 本地状态

- 工作目录：`E:\project\Obsidian插件\同步功能`
- 当前提交：`1b4e714 Add commercial STS endpoint check`
- 最近完成验证：25 个测试文件、175 条测试通过；构建、打包和 `git diff --check` 通过。
- 发布包：`release\obsidian-sync-plugin-0.1.1-commercial-sts-20260726-151445.zip`。
- 用户未跟踪内容：`.claude/` 和 `docs` 下两份 Word 文件。不要删除、覆盖或提交。
- 本次服务器操作未改本地源码。

## 安全边界

- 禁止读取、输出、复制或提交 `data.json`、`.env*`、`.commercial-sts/`、`*.secret`、账号文件及一切真实凭据。
- 禁止查看服务器 `deploy/commercial-sts/.env` 的内容；不要用 VNC 截图查看终端历史。
- 用户曾在终端输入过一对 AccessKey。不要复述；部署稳定后提醒其在阿里云轮换该 AccessKey。

## 已完成服务器操作

- Ubuntu 24.04 轻量服务器已安装 Docker、Compose 和命令助手 Agent。
- 服务器源码：`/opt/obsidian-e2ee-sync`；部署目录：`/opt/obsidian-e2ee-sync/deploy/commercial-sts`。
- 已成功 `git pull --ff-only origin master` 到 `1b4e714`。
- 已成功安全预检：`.env` 存在、权限已设为 `600`，且 `docker compose --env-file .env config --quiet` 成功。预检未输出配置值。

## 当前卡点

下列命令通过阿里云命令助手执行后以 `ExitCode 1` 失败，约 11 秒：

```bash
set -eu
cd /opt/obsidian-e2ee-sync/deploy/commercial-sts
docker compose build --pull backend
docker compose up -d
printf '%s\n' SERVICE_START_REQUESTED
```

尚不确定失败在镜像构建还是容器启动。不要猜测，也不要输出完整日志或环境变量。

## 下一步

在阿里云命令助手新建并执行此安全诊断命令。它只输出阶段状态：

```bash
set +e
cd /opt/obsidian-e2ee-sync/deploy/commercial-sts
docker compose build --pull backend >/dev/null 2>&1
BUILD_STATUS=$?
docker compose up -d >/dev/null 2>&1
UP_STATUS=$?
printf 'BUILD_STATUS=%s UP_STATUS=%s\n' "$BUILD_STATUS" "$UP_STATUS"
exit 0
```

- 构建和启动都成功后，执行：

```bash
curl -fsS http://127.0.0.1:8788/healthz
curl -fsS http://127.0.0.1:8788/readyz
```

- 未经用户明确确认，绝不切换 `sync.e2note.com` 的 DNS。
- 生产验收必须包含外网 `/healthz=200`、`/readyz=200/ready`、真实 STS/OSS 和 Obsidian 双端验证。

## 新窗口提示词

```text
继续开发和部署 E:\project\Obsidian插件\同步功能 的商业 STS MVP。

先阅读：
- docs/HANDOFF_COMMERCIAL_STS_SERVER_DEPLOY_20260726.md
- docs/HANDOFF_COMMERCIAL_STS_PRODUCTION_VALIDATED_20260717.md
- docs/HANDOFF_COMMERCIAL_STS_PLAN_B.md
- docs/COMMERCIAL_STS_BACKEND_CONTRACT.md
- docs/COMMERCIAL_STS_OPERATIONS_RUNBOOK.md

开始先运行：git status --short、git log -1 --oneline、git diff --check。

绝对安全：不读取、输出、复制或提交 data.json、.env*、.commercial-sts/、*.secret、真实 AccessKey/Secret/SecurityToken、令牌、同步密码、设备 ID、哈希盐。不要查看服务器 .env 内容，也不要用 VNC 截图查看终端历史。不要 reset、checkout、revert 或覆盖用户改动。

现状：服务器配置预检已通过（.env 存在、权限 600、Compose 可解析），但启动命令 docker compose build --pull backend && docker compose up -d 返回 ExitCode 1。先按交接文档的安全诊断命令确认 BUILD_STATUS 和 UP_STATUS，只输出脱敏状态。持续推进，不需要等待我；只有输入真实密钥、DNS 切换、付款或真实 Obsidian 操作时才暂停，并用最简单的一句话说明我需要在哪里操作。

启动成功后做本机 healthz 和 readyz 验收。未经我明确确认不要切换 sync.e2note.com DNS。每个阶段结束运行 git diff --check。不要提交或推送，除非有明确且不含敏感信息的本地改动。
```
