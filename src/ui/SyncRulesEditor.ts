import { App, Modal, Setting, Notice } from 'obsidian';
import { SyncRule } from '../types';
import { SyncRulesManager, RULE_TEMPLATES } from '../sync/SyncRules';

/**
 * 同步规则编辑器
 */
export class SyncRulesEditor extends Modal {
  private rules: SyncRule[];
  private rulesManager: SyncRulesManager;
  private onSave: (rules: SyncRule[]) => void;
  private rulesContainerEl: HTMLElement;

  constructor(
    app: App,
    rulesManager: SyncRulesManager,
    onSave: (rules: SyncRule[]) => void
  ) {
    super(app);
    this.rulesManager = rulesManager;
    this.rules = rulesManager.getRules();
    this.onSave = onSave;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass('sync-rules-editor');

    contentEl.createEl('h2', { text: '同步规则配置' });

    // 说明
    contentEl.createEl('p', {
      text: '配置哪些文件/文件夹需要同步。规则按顺序执行，include 规则优先级更高。',
      cls: 'rules-description'
    });

    // 预设模板
    contentEl.createEl('h3', { text: '预设模板' });
    const templatesEl = contentEl.createDiv({ cls: 'rules-templates' });

    new Setting(templatesEl)
      .setName('只同步笔记')
      .setDesc('只同步 Markdown 文件')
      .addButton(btn => btn.setButtonText('应用').onClick(() => {
        this.rules = [...RULE_TEMPLATES.notesOnly as SyncRule[]];
        this.renderRules();
      }));

    new Setting(templatesEl)
      .setName('排除附件')
      .setDesc('排除图片和 PDF 文件')
      .addButton(btn => btn.setButtonText('应用').onClick(() => {
        this.rules = [
          ...this.rules.filter(r => r.type === 'exclude' && !r.pattern.includes('*.png') && !r.pattern.includes('*.jpg')),
          ...(RULE_TEMPLATES.noAttachments as SyncRule[])
        ];
        this.renderRules();
      }));

    // 规则列表
    contentEl.createEl('h3', { text: '规则列表' });
    this.rulesContainerEl = contentEl.createDiv({ cls: 'rules-list' });
    this.renderRules();

    // 添加规则
    contentEl.createEl('h3', { text: '添加规则' });
    const addRuleEl = contentEl.createDiv({ cls: 'add-rule-section' });

    let newType: 'include' | 'exclude' = 'exclude';
    let newPattern = '';

    new Setting(addRuleEl)
      .setName('规则类型')
      .addDropdown(dropdown => dropdown
        .addOption('exclude', '排除')
        .addOption('include', '包含')
        .setValue(newType)
        .onChange(value => newType = value as 'include' | 'exclude'));

    new Setting(addRuleEl)
      .setName('路径模式')
      .setDesc('支持 glob 模式：* 任意字符，** 任意目录，? 单个字符')
      .addText(text => text
        .setPlaceholder('例如：attachments/**')
        .onChange(value => newPattern = value));

    new Setting(addRuleEl)
      .addButton(btn => btn
        .setButtonText('添加规则')
        .setCta()
        .onClick(() => {
          if (!newPattern.trim()) {
            new Notice('请输入路径模式');
            return;
          }

          const rule: SyncRule = {
            type: newType,
            pattern: newPattern.trim(),
            enabled: true,
          };

          const validation = this.rulesManager.validateRule(rule);
          if (!validation.valid) {
            new Notice(validation.error || '无效的规则');
            return;
          }

          this.rules.push(rule);
          this.renderRules();
          newPattern = '';
        }));

    // 操作按钮
    new Setting(contentEl)
      .addButton(btn => btn.setButtonText('取消').onClick(() => this.close()))
      .addButton(btn => btn
        .setButtonText('保存')
        .setCta()
        .onClick(() => {
          this.rulesManager.setRules(this.rules);
          this.onSave(this.rules);
          new Notice('规则已保存');
          this.close();
        }));
  }

  renderRules() {
    this.rulesContainerEl.empty();

    if (this.rules.length === 0) {
      this.rulesContainerEl.createDiv({
        text: '暂无规则，所有文件都会同步',
        cls: 'empty-rules'
      });
      return;
    }

    for (let i = 0; i < this.rules.length; i++) {
      const rule = this.rules[i];
      const ruleEl = this.rulesContainerEl.createDiv({ cls: 'rule-item' });

      // 规则信息
      const infoEl = ruleEl.createDiv({ cls: 'rule-info' });

      const typeEl = infoEl.createSpan({
        cls: `rule-type rule-type-${rule.type}`,
        text: rule.type === 'include' ? '包含' : '排除'
      });

      infoEl.createSpan({
        cls: 'rule-pattern',
        text: rule.pattern
      });

      // 操作
      const actionsEl = ruleEl.createDiv({ cls: 'rule-actions' });

      // 启用/禁用
      new Setting(actionsEl)
        .addToggle(toggle => toggle
          .setValue(rule.enabled)
          .onChange(enabled => {
            this.rules[i].enabled = enabled;
          }));

      // 上移
      if (i > 0) {
        new Setting(actionsEl)
          .addButton(btn => btn
            .setIcon('arrow-up')
            .setTooltip('上移')
            .onClick(() => {
              [this.rules[i - 1], this.rules[i]] = [this.rules[i], this.rules[i - 1]];
              this.renderRules();
            }));
      }

      // 下移
      if (i < this.rules.length - 1) {
        new Setting(actionsEl)
          .addButton(btn => btn
            .setIcon('arrow-down')
            .setTooltip('下移')
            .onClick(() => {
              [this.rules[i], this.rules[i + 1]] = [this.rules[i + 1], this.rules[i]];
              this.renderRules();
            }));
      }

      // 删除
      new Setting(actionsEl)
        .addButton(btn => btn
          .setIcon('trash')
          .setTooltip('删除')
          .setWarning()
          .onClick(() => {
            this.rules.splice(i, 1);
            this.renderRules();
          }));
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}

/**
 * 文件夹选择器
 */
export class FolderPickerModal extends Modal {
  private onSelect: (folder: string) => void;

  constructor(app: App, onSelect: (folder: string) => void) {
    super(app);
    this.onSelect = onSelect;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.createEl('h2', { text: '选择文件夹' });

    const folders = this.app.vault.getAllFolders();

    for (const folder of folders) {
      if (folder.path === '/') continue;

      new Setting(contentEl)
        .setName(folder.path)
        .addButton(btn => btn
          .setButtonText('选择')
          .onClick(() => {
            this.onSelect(folder.path);
            this.close();
          }));
    }
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
