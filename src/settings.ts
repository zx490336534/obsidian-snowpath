import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { preferredEnglishVoices } from "./core";
import type SnowpathPlugin from "./main";
import type { ProviderId } from "./types";

export class SnowpathSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: SnowpathPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("snowpath-settings");
    containerEl.createEl("h1", { text: "Snowpath 设置" });
    containerEl.createEl("p", { text: "选择故事生成方式。密钥不会写入学习笔记。", cls: "setting-item-description" });

    new Setting(containerEl)
      .setName("AI 提供方式")
      .setDesc("本地 CLI 不需要在插件中保存 API Key。")
      .addDropdown((dropdown) => dropdown
        .addOption("codex-cli", "Codex CLI")
        .addOption("claude-cli", "Claude CLI")
        .addOption("openai-compatible", "OpenAI-compatible API")
        .setValue(this.plugin.settings.provider)
        .onChange(async (value) => {
          this.plugin.settings.provider = value as ProviderId;
          await this.plugin.saveSettings();
          this.display();
        }));

    if (this.plugin.settings.provider === "openai-compatible") this.renderApiSettings(containerEl);
    else this.renderCliSettings(containerEl);

    new Setting(containerEl)
      .setName("测试连接")
      .setDesc(`向 ${this.plugin.ai.providerLabel()} 发送一条最小测试消息。`)
      .addButton((button) => button.setButtonText("开始测试").setCta().onClick(async () => {
        button.setDisabled(true).setButtonText("测试中…");
        try {
          new Notice(await this.plugin.ai.testConnection());
        } catch (error) {
          new Notice(error instanceof Error ? error.message : String(error), 8000);
        } finally {
          button.setDisabled(false).setButtonText("开始测试");
        }
      }));

    containerEl.createEl("h2", { text: "学习体验" });
    new Setting(containerEl)
      .setName("数据目录")
      .setDesc("世界、章节、生词与进度笔记的根目录。")
      .addText((text) => text.setValue(this.plugin.settings.dataRoot).onChange(async (value) => {
        const normalized = value.trim().replace(/^\/+|\/+$/g, "");
        if (!normalized) return;
        this.plugin.settings.dataRoot = normalized;
        await this.plugin.saveSettings();
      }));

    const voices = typeof speechSynthesis === "undefined" ? [] : preferredEnglishVoices(speechSynthesis.getVoices());
    new Setting(containerEl)
      .setName("朗读声音")
      .setDesc("只显示清晰自然的英文声线；自动会选择当前设备上的首选声音。")
      .addDropdown((dropdown) => {
        dropdown.addOption("", "自动选择（推荐）");
        for (const voice of voices) dropdown.addOption(voice.name, `${voice.name} · ${voice.lang}`);
        const selected = voices.some((voice) => voice.name === this.plugin.settings.ttsVoice) ? this.plugin.settings.ttsVoice : "";
        dropdown.setValue(selected).onChange(async (value) => {
          this.plugin.settings.ttsVoice = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("朗读速度")
      .setDesc(this.plugin.settings.ttsRate.toFixed(2))
      .addSlider((slider) => slider.setLimits(0.8, 1.1, 0.05).setValue(this.plugin.settings.ttsRate).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.ttsRate = value;
        await this.plugin.saveSettings();
      }));

    new Setting(containerEl)
      .setName("每章目标词数")
      .setDesc("AI 会自然地把这些待强化词汇写进故事。")
      .addSlider((slider) => slider.setLimits(3, 10, 1).setValue(this.plugin.settings.wordsPerChapter).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.wordsPerChapter = value;
        await this.plugin.saveSettings();
      }));

    containerEl.createEl("h2", { text: "关于" });
    const about = containerEl.createEl("p", { cls: "setting-item-description" });
    about.appendText("Snowpath 是一款 Obsidian 英语冒险插件，灵感来自 ");
    about.createEl("a", { text: "I+1 Quest", href: "https://snowball-diary.github.io/iplus1-quest/" });
    about.appendText("。");
  }

  private renderCliSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("CLI 路径")
      .setDesc("留空时自动从 PATH 与常见本地安装目录查找 codex 或 claude。")
      .addText((text) => text.setPlaceholder(this.plugin.settings.provider === "codex-cli" ? "codex" : "claude").setValue(this.plugin.settings.cliPath).onChange(async (value) => {
        this.plugin.settings.cliPath = value.trim();
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName("模型")
      .setDesc("留空时使用 CLI 当前默认模型。")
      .addText((text) => text.setPlaceholder("使用 CLI 默认值").setValue(this.plugin.settings.cliModel).onChange(async (value) => {
        this.plugin.settings.cliModel = value.trim();
        await this.plugin.saveSettings();
      }));
  }

  private renderApiSettings(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Base URL")
      .setDesc("插件会请求 /chat/completions。")
      .addText((text) => text.setPlaceholder("https://api.openai.com/v1").setValue(this.plugin.settings.apiBaseUrl).onChange(async (value) => {
        this.plugin.settings.apiBaseUrl = value.trim();
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName("模型")
      .addText((text) => text.setPlaceholder("gpt-4.1-mini").setValue(this.plugin.settings.apiModel).onChange(async (value) => {
        this.plugin.settings.apiModel = value.trim();
        await this.plugin.saveSettings();
      }));
    new Setting(containerEl)
      .setName("API Key")
      .setDesc(this.plugin.settings.apiKeyCipher ? "已使用系统安全存储加密；输入新值可替换。" : "也可以通过 OPENAI_API_KEY 环境变量提供。")
      .addText((text) => {
        text.inputEl.type = "password";
        text.setPlaceholder(this.plugin.settings.apiKeyCipher ? "已安全保存" : "sk-…").onChange(async (value) => {
          if (value.trim()) await this.plugin.setApiKey(value.trim());
        });
      });
  }
}
