import { Notice, Plugin, type TAbstractFile, type WorkspaceLeaf } from "obsidian";
import { SnowpathAI } from "./ai";
import { SnowpathSettingTab } from "./settings";
import { SnowpathStore } from "./storage";
import { DEFAULT_SETTINGS, type Route, type SnowpathSettings } from "./types";
import { ImportVocabularyModal, SnowpathView, SNOWPATH_VIEW_TYPE } from "./view";

interface PersistedData {
  settings?: Partial<SnowpathSettings>;
}

interface ElectronSafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

export default class SnowpathPlugin extends Plugin {
  settings: SnowpathSettings = { ...DEFAULT_SETTINGS };
  store!: SnowpathStore;
  ai!: SnowpathAI;
  private sessionApiKey = "";
  private refreshTimer = 0;

  async onload(): Promise<void> {
    await this.loadSettings();
    this.store = new SnowpathStore(this.app, () => this.settings.dataRoot);
    this.ai = new SnowpathAI(() => this.settings, () => this.getApiKey());

    this.registerView(SNOWPATH_VIEW_TYPE, (leaf) => new SnowpathView(leaf, this));
    this.addRibbonIcon("snowflake", "打开 Snowpath", () => void this.openRoute("adventure"));
    this.addCommand({ id: "open-snowpath", name: "打开 Snowpath", callback: () => void this.openRoute("adventure") });
    this.addCommand({ id: "continue-adventure", name: "继续上次冒险", callback: () => void this.openRoute("adventure") });
    this.addCommand({ id: "import-vocabulary", name: "导入词表", callback: () => new ImportVocabularyModal(this.app, this).open() });
    this.addCommand({ id: "start-review", name: "开始今日复习", callback: () => void this.openRoute("review") });
    this.addSettingTab(new SnowpathSettingTab(this.app, this));

    const refresh = (file: TAbstractFile) => {
      if (!this.store.isOwnedPath(file.path)) return;
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = window.setTimeout(() => this.getViews().forEach((view) => void view.requestRefresh()), 250);
    };
    this.registerEvent(this.app.vault.on("create", refresh));
    this.registerEvent(this.app.vault.on("modify", refresh));
    this.registerEvent(this.app.vault.on("delete", refresh));
    this.registerEvent(this.app.vault.on("rename", refresh));
  }

  onunload(): void {
    window.clearTimeout(this.refreshTimer);
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    this.app.workspace.detachLeavesOfType(SNOWPATH_VIEW_TYPE);
  }

  private getViews(): SnowpathView[] {
    return this.app.workspace.getLeavesOfType(SNOWPATH_VIEW_TYPE)
      .map((leaf) => leaf.view)
      .filter((view): view is SnowpathView => view instanceof SnowpathView);
  }

  async openRoute(route: Route): Promise<void> {
    let leaf: WorkspaceLeaf | null = this.app.workspace.getLeavesOfType(SNOWPATH_VIEW_TYPE)[0] ?? null;
    if (!leaf) {
      leaf = this.app.workspace.getLeaf(true);
      await leaf.setViewState({ type: SNOWPATH_VIEW_TYPE, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
    const view = leaf.view;
    if (view instanceof SnowpathView) await view.setRoute(route);
  }

  openSettings(): void {
    const app = this.app as typeof this.app & { setting: { open(): void; openTabById(id: string): void } };
    app.setting.open();
    app.setting.openTabById(this.manifest.id);
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData() || {}) as PersistedData;
    this.settings = { ...DEFAULT_SETTINGS, ...(data.settings ?? {}) };
  }

  async saveSettings(): Promise<void> {
    await this.saveData({ settings: this.settings } satisfies PersistedData);
  }

  private safeStorage(): ElectronSafeStorage | null {
    try {
      const electron = require("electron") as { safeStorage?: ElectronSafeStorage };
      return electron.safeStorage?.isEncryptionAvailable() ? electron.safeStorage : null;
    } catch {
      return null;
    }
  }

  getApiKey(): string {
    if (this.sessionApiKey) return this.sessionApiKey;
    if (this.settings.apiKeyCipher) {
      try {
        const safeStorage = this.safeStorage();
        if (safeStorage) return safeStorage.decryptString(Buffer.from(this.settings.apiKeyCipher, "base64"));
      } catch {
        new Notice("无法解密 Snowpath API Key，请在设置中重新输入", 7000);
      }
    }
    return process.env.OPENAI_API_KEY?.trim() ?? "";
  }

  async setApiKey(value: string): Promise<void> {
    this.sessionApiKey = value;
    const safeStorage = this.safeStorage();
    if (!safeStorage) {
      this.settings.apiKeyCipher = "";
      await this.saveSettings();
      new Notice("系统安全存储不可用：API Key 仅保留到本次 Obsidian 关闭");
      return;
    }
    this.settings.apiKeyCipher = safeStorage.encryptString(value).toString("base64");
    await this.saveSettings();
    new Notice("API Key 已使用系统安全存储加密");
  }
}
