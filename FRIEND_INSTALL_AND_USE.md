# Obsidian 同步插件安装和使用说明

这是一份给朋友或同事使用的简化说明。

目标：

```text
把这个插件安装到 Obsidian。
配置对象存储。
让一台、两台或多台电脑同步同一个 Obsidian 笔记库。
```

---

## 一、压缩包里有什么

压缩包里应该包含：

```text
main.js
manifest.json
styles.css
FRIEND_INSTALL_AND_USE.md
OBSIDIAN_SYNC_PLUGIN_USER_MANUAL.md
docs/ALIYUN_OSS_SYNC_SETUP_AND_TROUBLESHOOTING.md
docs/MULTI_USER_REPOSITORY_ISOLATION.md
```

不要自己添加或复制：

```text
data.json
```

`data.json` 是每台电脑自己的本地配置文件，里面可能包含访问密钥、同步密码、设备 ID。不同电脑不要互相复制这个文件。

---

## 二、安装到 Obsidian

在你的 Obsidian 笔记库里找到插件目录：

```text
你的笔记库\.obsidian\plugins\
```

如果没有 `plugins` 文件夹，可以手动创建。

然后把压缩包解压出来的整个文件夹放进去，例如：

```text
你的笔记库\.obsidian\plugins\obsidian-sync-plugin\
```

确认这个文件夹里直接能看到：

```text
main.js
manifest.json
styles.css
```

不要变成这种多套一层的结构：

```text
你的笔记库\.obsidian\plugins\obsidian-sync-plugin\obsidian-sync-plugin\main.js
```

---

## 三、在 Obsidian 里启用插件

打开 Obsidian：

```text
设置 -> 第三方插件
```

如果还没有关闭安全模式，先关闭安全模式。

然后在已安装插件列表里找到同步插件，启用它。

启用后进入插件设置页：

```text
设置 -> E2EE Sync
```

---

## 四、第一台电脑怎么配置

第一台电脑只需要填写 5 项：

```text
服务地址
存储桶名称
访问密钥 ID
访问密钥密码
同步密码
```

说明：

```text
服务地址：对象存储的 endpoint，例如阿里云 OSS endpoint。
存储桶名称：bucket 名称。
访问密钥 ID：对象存储服务商给你的 AccessKey ID。
访问密钥密码：对象存储服务商给你的 AccessKey Secret。
同步密码：你自己设置的加密密码，其他电脑必须填完全一样。
```

然后按顺序点击：

```text
检查配置
测试连接
同步
```

第一台同步成功后，再点击：

```text
复制第二台配置
```

---

## 五、第二台、第三台电脑怎么配置

第二台、第三台电脑同样先安装这个插件。

注意：

```text
不要从第一台复制 data.json。
```

在第二台或第三台插件设置页点击：

```text
粘贴配置
```

然后补充 3 项：

```text
访问密钥 ID
访问密钥密码
同步密码
```

其中：

```text
访问密钥 ID：可以和第一台一样。
访问密钥密码：可以和第一台一样。
同步密码：必须和第一台完全一样。
```

然后按顺序点击：

```text
检查配置
测试连接
同步
```

同步成功后，这台电脑就会下载远端已有的笔记。

---

## 六、多个人使用时怎么避免串数据

同一个人的多台电脑：

```text
同步通道 / 仓库 ID 要一样。
同步密码要一样。
```

不同人之间：

```text
同步通道 / 仓库 ID 必须不同。
同步密码也应该不同。
最好使用不同的访问密钥或不同的存储桶。
```

如果多个人共用同一个对象存储账号，建议每个人使用不同的同步通道前缀。

更详细说明见：

```text
docs/MULTI_USER_REPOSITORY_ISOLATION.md
```

---

## 七、常见问题

### 连接失败

检查：

```text
服务地址是否正确
存储桶名称是否正确
访问密钥 ID 是否正确
访问密钥密码是否正确
当前网络是否能访问对象存储
```

### 解密失败

最常见原因：

```text
同步密码和第一台不一样。
```

处理：

```text
把所有电脑的同步密码改成完全一样。
```

### 第二台没有下载文件

检查：

```text
第一台是否已经点过“同步”
第二台是否点过“粘贴配置”
第二台是否补充了访问密钥和同步密码
第二台同步密码是否和第一台完全一样
```

### 不小心复制了 data.json

建议：

```text
关闭 Obsidian
删除第二台插件目录里的 data.json
重新打开 Obsidian
重新配置第二台
```

---

## 八、最重要的一句话

```text
发给别人时，只发插件压缩包，不要发 data.json。
```

```text
同一个人的多台电脑，同步密码要一样。
不同人的数据隔离，靠不同同步通道 / 仓库 ID。
```
