# 贡献指南

感谢您有兴趣为本项目做出贡献！

## 开发环境设置

```bash
# 克隆仓库
git clone <repo-url>
cd obsidian-sync-plugin

# 安装依赖
npm install

# 开发模式（热重载）
npm run dev

# 运行测试
npm test

# 构建
npm run build
```

## 项目结构

```
├── main.ts                    # 插件入口
├── manifest.json              # 插件清单
├── src/
│   ├── types/index.ts         # 类型定义
│   ├── crypto/
│   │   └── CryptoService.ts   # 加密服务
│   ├── sync/
│   │   ├── SyncManager.ts     # 同步管理器
│   │   ├── LocalIndex.ts      # 本地索引
│   │   └── RemoteStorage.ts   # 远端存储
│   ├── settings/
│   │   └── SyncSettingsTab.ts # 设置面板
│   └── utils/
│       ├── errors.ts          # 错误处理
│       ├── progress.ts        # 进度管理
│       └── retry.ts           # 重试机制
├── tests/                     # 测试文件
└── docs/                      # 文档
```

## 代码规范

### TypeScript

- 使用严格模式
- 为所有公共 API 添加类型注解
- 避免使用 `any`，使用 `unknown` 代替

### 注释

- 使用中文注释
- 为公共方法添加 JSDoc 注释

```typescript
/**
 * 加密数据
 * @param plaintext - 原始数据
 * @returns 加密包
 */
async encryptData(plaintext: Uint8Array): Promise<EncryptedPackage>
```

### 命名规范

- 类名：PascalCase（如 `SyncManager`）
- 方法名：camelCase（如 `startSync`）
- 常量：UPPER_SNAKE_CASE（如 `MAX_RETRIES`）
- 私有成员：下划线前缀（如 `_internalState`）

## 提交规范

使用约定式提交：

```
feat: 添加新功能
fix: 修复 bug
docs: 文档更新
test: 测试相关
refactor: 代码重构
chore: 构建/工具变更
```

示例：

```
feat: 添加选择性同步功能
fix: 修复大文件上传失败的问题
docs: 更新 API 文档
```

## 测试

### 运行测试

```bash
npm test              # 运行所有测试
npm run test:watch    # 监听模式
npm run test:coverage # 覆盖率报告
```

### 编写测试

- 测试文件放在 `tests/` 目录
- 文件命名：`*.test.ts`
- 使用 Vitest 框架

```typescript
import { describe, it, expect } from 'vitest';

describe('MyComponent', () => {
  it('应该正确工作', () => {
    expect(true).toBe(true);
  });
});
```

## Pull Request 流程

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/my-feature`
3. 提交更改：`git commit -m 'feat: 添加某某功能'`
4. 推送分支：`git push origin feature/my-feature`
5. 创建 Pull Request

### PR 检查清单

- [ ] 代码通过 TypeScript 编译
- [ ] 所有测试通过
- [ ] 新功能有对应测试
- [ ] 文档已更新（如需要）
- [ ] 提交信息符合规范

## 问题反馈

发现 Bug 或有功能建议？请创建 Issue：

1. 使用清晰的标题
2. 描述问题的复现步骤
3. 提供环境信息（操作系统、Obsidian 版本等）
4. 附上相关日志（如有）

## 代码风格

项目使用 EditorConfig 和 ESLint（如有配置）保持代码风格一致。

## 许可证

本项目采用 MIT 许可证。贡献的代码将采用相同许可证。
