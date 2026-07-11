# 商业化多用户 OSS 访问与隔离方案

这个文档用于后续商业化使用时参考，重点回答：

```text
如果有 100 个用户使用同步插件，要不要给每个用户创建不同的访问密钥？
阿里云 RAM 用户能创建多少个？
是否需要创建 100 个 RAM 用户？
商业化更推荐哪种方案？
```

---

## 一、先说结论

如果只是个人自用：

```text
一套访问密钥可以给自己多台电脑使用。
```

如果是商业化、多用户使用：

```text
不建议所有用户共用一套访问密钥。
```

更推荐：

```text
短期方案：每个用户一个 RAM 用户 / 一套 AccessKey / 一个独立同步路径。
长期方案：你的后端服务签发 STS 临时凭证，不把永久 AccessKey 发给用户。
```

---

## 二、阿里云 RAM 用户数量限制

根据阿里云 RAM 官方文档：

```text
一个阿里云账号最多可以创建 5000 个 RAM 用户。
一个 RAM 用户最多可以创建 2 个访问密钥 AccessKey。
```

所以如果你有 100 个用户：

```text
可以创建 100 个 RAM 用户。
数量上没有问题。
```

但是，能创建不代表一定是最优方案。商业化最终更推荐 STS 临时凭证方案。

参考：

```text
https://help.aliyun.com/zh/ram/product-overview/limits
```

---

## 三、为什么不建议所有用户共用同一个 AccessKey

技术上，所有用户可以共用同一个：

```text
服务地址
存储桶名称
访问密钥 ID
访问密钥密码
```

只要每个用户使用不同：

```text
同步通道前缀
仓库 ID
同步密码
```

数据通常不会混到一起。

但是商业化不建议这么做，原因是：

```text
一套 AccessKey 泄露，会影响所有用户。
用户理论上拥有同一个 bucket 的访问能力。
用户填错同步通道，可能写到别人的路径。
用户或程序异常时，可能误删、覆盖、干扰其他用户文件。
你无法精确停用某一个用户的访问权限。
```

所以：

```text
共用 AccessKey 适合测试。
商业化不要长期这么做。
```

---

## 四、短期可落地方案：每个用户一个 RAM 用户

这个方案适合早期商业化、用户数量不大时使用。

假设总 bucket 是：

```text
obsidian-sync-commercial
```

每个用户使用不同路径：

```text
tenants/用户ID/
```

例如：

```text
张三：tenants/zhangsan/
李四：tenants/lisi/
用户 001：tenants/user-001/
用户 002：tenants/user-002/
```

每个用户单独创建一个 RAM 用户：

```text
obsidian-user-001
obsidian-user-002
obsidian-user-003
```

每个 RAM 用户创建一套 AccessKey：

```text
AccessKey ID
AccessKey Secret
```

然后给每个 RAM 用户单独授权，只允许访问自己的 OSS 路径。

---

## 五、100 个用户是否要创建 100 个 RAM 用户

短期方案下，是的，可以这样做：

```text
100 个真实用户
创建 100 个 RAM 用户
每个 RAM 用户一套 AccessKey
每个 RAM 用户只允许访问自己的路径
```

这样做的优点：

```text
用户之间权限隔离更清楚。
某个用户泄露密钥，只影响这个用户。
某个用户停用时，可以禁用这个 RAM 用户或删除 AccessKey。
排查问题时能知道是哪一个 RAM 用户在访问 OSS。
```

缺点：

```text
人工创建和维护比较麻烦。
用户多了以后，AccessKey 发放、保存、轮换、禁用都会变成运维工作。
用户端保存的是长期 AccessKey，泄露后仍然有风险。
```

所以这个方案适合：

```text
内测
小规模商业化
早期手工运营
企业内部部署
```

---

## 六、如何在阿里云控制台创建多个 RAM 用户

操作路径：

```text
阿里云控制台
RAM 访问控制
身份管理
用户
创建用户
```

创建用户时：

```text
登录名称：obsidian-user-001
显示名称：用户 001 或客户名称
访问方式：使用永久 AccessKey 访问
```

阿里云会生成：

```text
AccessKey ID
AccessKey Secret
```

注意：

```text
AccessKey Secret 只在创建时显示。
页面关闭后不能再次查看。
如果忘记，只能重新创建新的 AccessKey。
```

阿里云创建 RAM 用户页面支持“添加用户”，可以一次添加多个用户。

参考：

```text
https://help.aliyun.com/zh/ram/user-guide/create-a-ram-user
```

---

## 七、每个用户应该怎么填插件

假设张三的路径是：

```text
tenants/zhangsan
```

张三两台电脑都填：

```text
服务地址：同一个 OSS endpoint
存储桶名称：obsidian-sync-commercial
访问密钥 ID：张三 RAM 用户的 AccessKey ID
访问密钥密码：张三 RAM 用户的 AccessKey Secret
同步通道前缀：tenants/zhangsan
仓库 ID：张三自己的仓库 ID
同步密码：张三自己的同步密码
```

李四两台电脑都填：

```text
服务地址：同一个 OSS endpoint
存储桶名称：obsidian-sync-commercial
访问密钥 ID：李四 RAM 用户的 AccessKey ID
访问密钥密码：李四 RAM 用户的 AccessKey Secret
同步通道前缀：tenants/lisi
仓库 ID：李四自己的仓库 ID
同步密码：李四自己的同步密码
```

同一个用户的多台电脑：

```text
同步通道前缀一样
仓库 ID 一样
同步密码一样
```

不同用户之间：

```text
同步通道前缀不同
仓库 ID 不同
同步密码不同
访问密钥最好也不同
```

---

## 八、权限策略应该怎么设计

商业化时，不要给每个 RAM 用户 `AliyunOSSFullAccess`。

更推荐最小权限：

```text
只允许访问指定 bucket。
只允许访问 tenants/当前用户ID/ 这一段路径。
```

例如张三只允许访问：

```text
oss://obsidian-sync-commercial/tenants/zhangsan/
```

李四只允许访问：

```text
oss://obsidian-sync-commercial/tenants/lisi/
```

这样即使张三的 AccessKey 泄露，也尽量只影响张三自己的数据。

---

## 九、长期正式商业化方案：STS 临时凭证

长期商业化更推荐：

```text
不要把永久 AccessKey 发给用户。
由你的后端服务给用户签发短期有效的 STS 临时凭证。
```

基本流程：

```text
用户登录你的账号系统
插件向你的后端请求同步凭证
你的后端验证用户身份和会员状态
你的后端向阿里云 STS 申请临时访问凭证
后端把临时凭证返回给插件
插件用临时凭证访问 OSS
临时凭证过期后，插件重新向后端申请
```

STS 临时凭证通常包含：

```text
AccessKey ID
AccessKey Secret
SecurityToken
Expiration
```

临时凭证的权限可以限制到：

```text
只允许访问某个 bucket
只允许访问 tenants/用户ID/ 路径
只允许在一定时间内有效
```

参考：

```text
https://help.aliyun.com/zh/oss/developer-reference/use-temporary-access-credentials-provided-by-sts-to-access-oss
```

---

## 十、STS 方案的优点和代价

优点：

```text
用户拿不到永久 AccessKey。
凭证泄露后，过期就失效。
用户停用或退订后，可以立刻停止发放凭证。
权限可以按用户、会员状态、设备状态动态控制。
更适合真正商业化。
```

代价：

```text
需要开发后端服务。
插件需要支持 SecurityToken。
插件需要支持凭证过期后的自动刷新。
需要设计用户登录、会员状态、设备绑定等逻辑。
```

当前插件如果还只支持永久 AccessKey，后续要商业化，可以把 STS 支持作为一个独立版本迭代。

---

## 十一、推荐路线

### 阶段 1：个人自用 / 小范围测试

```text
一个 bucket
一套 AccessKey
不同用户使用不同同步通道前缀和仓库 ID
```

只适合测试，不建议正式商用。

### 阶段 2：早期商业化

```text
一个 bucket
每个用户一个 RAM 用户
每个用户一套 AccessKey
每个用户一个独立路径 tenants/用户ID/
每个用户只授权自己的路径
```

适合几十到几百个用户的早期运营。

### 阶段 3：正式 SaaS 化

```text
账号系统
会员系统
后端 STS 签发服务
插件支持临时凭证
按用户路径隔离 OSS 数据
```

这是长期更稳的商业化方案。

---

## 十二、最终建议

如果现在马上要给 100 个人使用：

```text
可以创建 100 个 RAM 用户。
每个用户一套 AccessKey。
每个用户独立同步通道前缀。
每个用户独立仓库 ID。
每个用户独立同步密码。
```

如果你计划长期商业化：

```text
不要把“用户自己填写 AccessKey”作为最终方案。
最终应该改成“用户登录插件，插件自动从你的服务器获取临时同步凭证”。
```

一句话：

```text
短期：每用户 RAM + 每用户 AccessKey。
长期：后端 STS + 临时凭证 + 每用户路径隔离。
```
