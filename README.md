# Obsidian 同步插件

这是一个用于多设备同步 Obsidian 笔记的插件。

普通使用只需要：

```text
第一台：填 5 项，然后同步。
第二台：粘贴第一台配置，再补 3 项，然后同步。
```

## 安装

构建：

```powershell
npm.cmd run build
```

复制到 Obsidian 插件目录：

```text
main.js
manifest.json
styles.css（如果有）
```

不要复制：

```text
data.json
```

## 第一台电脑

打开插件设置页：

```text
设置 -> E2EE Sync
```

只填 5 项：

```text
服务地址
存储桶名称
访问密钥 ID
访问密钥密码
同步密码
```

然后点：

```text
检查配置
测试连接
同步
复制第二台配置
```

## 第二台电脑

第二台只复制插件文件：

```text
main.js
manifest.json
styles.css（如果有）
```

不要复制：

```text
data.json
```

第二台打开插件设置页，先点：

```text
粘贴配置
```

然后只补 3 项：

```text
访问密钥 ID
访问密钥密码
同步密码
```

其中同步密码必须和第一台完全一样。

然后点：

```text
检查配置
测试连接
同步
```

## 完整手册

请看：

```text
OBSIDIAN_SYNC_PLUGIN_USER_MANUAL.md
```

## 开发验证

```powershell
npm.cmd test
npm.cmd run build
```
