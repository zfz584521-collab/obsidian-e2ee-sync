# 商业 STS 安全轮换验收交接（2026-07-30）

## 当前结论

阶段 E、阶段 B 与阶段 C 已完成，阶段 D 尚未开始。

### 阶段 E：本地发布验收

- 测试：25 个测试文件、176 个测试全部通过。
- 构建：通过。
- 发布包与严格干净安装：通过。
- 发布包：`release/obsidian-sync-plugin-0.1.1-commercial-sts-20260730-094309.zip`
- SHA-256：`1C7FBC17D3AFC2C6C898DB95EFA4EE9792A8201DE587AEFA6568DD1DA2BD575B`

### 阶段 B：生产凭证安全轮换

- 新凭证通过本地 RSA-OAEP-SHA256 一次性加密页面传入。
- 服务器只接收密文；一次性私钥、密文文件和解密临时文件均在命令结束时清理。
- 新凭证已原子写入，重复配置项已合并，配置文件权限保持为 `600`。
- 后端已强制重建并恢复健康。
- OSS 运行时区域与端点已规范为已验证组合。
- OSS Bucket 标识通过独立的一次性密文流程修复，未写入命令或日志。
- 删除旧凭证前，五项验收全部通过。
- 较早创建且已经暴露的旧 AccessKey 已删除；RAM 页面确认仅保留一个新 AccessKey，状态为启用。
- 删除旧凭证后，五项验收再次全部通过。

删除前与删除后的固定验收结果均为：

```text
BACKEND_STATE=PASS
HEALTH_STATUS=PASS
READY_STATUS=PASS
STS_STATUS=PASS
OSS_STATUS=PASS
```

其中 OSS 验收包含授权前缀的 List、Put、Get、Delete、测试对象清理，以及跨前缀访问拒绝。

### 阶段 C：DNS 与公网 HTTPS 验收

- 权威 DoH 查询确认 `sync.e2note.com` 已指向目标服务器 `47.76.177.116`。
- AliDNS 与 Google Public DNS 返回结果一致，TTL 为约 600 秒。
- 当前记录已经正确，因此未进行不必要的 DNS 改写。
- TLS 1.3 握手成功，证书策略错误为 `None`。
- 证书有效期：2026-07-17 至 2026-10-15。
- 公网 `GET /healthz` 返回 HTTP `200`，状态为 `ok`。
- 公网 `GET /readyz` 返回 HTTP `200`，状态为 `ready`，provider 为 `aliyun`。
- 公网 CORS `OPTIONS /api/sync/credentials` 返回 HTTP `204`，允许 `POST,OPTIONS` 及 `authorization,content-type`。
- 不携带授权令牌的凭证请求返回 HTTP `401`。

## 安全边界

- 本交接不记录 AccessKey、Secret、SecurityToken、授权令牌、同步密码、设备 ID、哈希盐或 Bucket 名称。
- 未读取或输出服务器 `.env` 内容。
- 一次性本地加密目录和本地临时 HTTP 服务已清理。
- 旧交接文档和用户未跟踪文件均保留。

## 后续固定顺序

1. 阶段 D：由用户进行真实 Obsidian 双端验收。

阶段 D 不能用当前服务器内网或公网接口验收代替。

具体操作与验收清单：

- `docs/OBSIDIAN_REAL_TWO_DEVICE_ACCEPTANCE_20260730.md`

继续工作的新窗口提示词：

- `docs/NEW_WINDOW_PROMPT_COMMERCIAL_STS_STAGE_D_20260730.md`
