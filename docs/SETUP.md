# 快速开始指南

本文档帮助您在 5 分钟内完成同步插件的配置。

## 准备工作

1. 一个 S3 兼容存储服务账号（推荐 Cloudflare R2，免费 10GB）
2. 两台或更多需要同步的设备
3. Obsidian 已安装

## 步骤 1：创建 S3 存储桶

### Cloudflare R2（推荐）

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. 进入 R2 对象存储
3. 创建存储桶，记录名称
4. 创建 API 令牌，记录：
   - Access Key ID
   - Secret Access Key
   - 端点地址（格式：`https://<account-id>.r2.cloudflarestorage.com`）

### AWS S3

1. 登录 AWS Console
2. 创建 S3 存储桶
3. 创建 IAM 用户，获取访问密钥
4. 设置权限策略：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket",
        "s3:HeadObject"
      ],
      "Resource": [
        "arn:aws:s3:::your-bucket-name",
        "arn:aws:s3:::your-bucket-name/*"
      ]
    }
  ]
}
```

## 步骤 2：安装插件

1. 下载插件文件到 `.obsidian/plugins/obsidian-sync-plugin/`
2. 重启 Obsidian
3. 设置 → 第三方插件 → 启用「同步插件」

## 步骤 3：配置第一台设备

1. 打开设置 → 同步插件

2. **填写 S3 配置**：

   | 字段 | 值 |
   |------|-----|
   | 服务端点 | `https://xxx.r2.cloudflarestorage.com` |
   | 存储桶 | `my-obsidian-vault` |
   | 区域 | `auto` |
   | 访问密钥 | 你的 Access Key |
   | 访问密钥密码 | 你的 Secret Key |

3. **设置同步密码**：
   - 输入一个强密码（例如：`MyStr0ng$yncP@ssword!`）
   - ⚠️ **请务必记住此密码！**

4. **设置设备名称**：例如「办公室电脑」

5. **测试连接**：点击「测试连接」按钮

6. **首次同步**：点击「同步」按钮

## 步骤 4：配置其他设备

1. 在新设备上安装插件

2. **使用相同的配置**：
   - 相同的 S3 配置
   - 相同的同步密码
   - 不同的设备名称（例如「家里笔记本」）

3. 点击「同步」开始同步

## 步骤 5：验证同步

1. 在设备 A 创建一个测试笔记
2. 在设备 B 点击同步
3. 确认测试笔记出现在设备 B

## 常见问题

### Q: 同步密码忘记了怎么办？

A: 很遗憾，同步密码无法恢复。您需要：
1. 清空远端存储桶
2. 使用新密码重新配置所有设备

### Q: 可以选择性同步某些文件夹吗？

A: 目前暂不支持，会在未来版本添加。

### Q: 同步会消耗多少流量？

A: 只同步变更的文件，首次同步取决于仓库大小。

### Q: 移动端如何配置？

A: 配置方法与桌面端相同，确保使用相同的 S3 配置和同步密码。

## 下一步

- 启用自动同步，设置合适的同步间隔
- 定期备份重要数据
- 如遇问题，查看 [故障排除](../README.md#故障排除) 章节
