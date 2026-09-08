import { App, ItemView, Modal, Notice, Setting, setIcon, TFile, type WorkspaceLeaf } from "obsidian";
import {
  aggregateProgress,
  computeQuizLevel,
  createRandomWorldPreview,
  levelIndex,
  MAX_STORY_DIRECTIONS,
  nextAdaptiveTarget,
  parseWordList,
  pickAssessmentItem,
  preferredEnglishVoices,
  scheduleReview,
  scoreAssessment,
  STORY_AUDIENCES,
  STORY_DIRECTIONS,
  STORY_DRIVES,
  STORY_MOODS,
  STORY_PROTAGONISTS,
  STORY_SETTINGS,
  type RandomWorldPreview,
  type StoryMixOption,
} from "./core";
import type SnowpathPlugin from "./main";
import {
  CEFR_LEVELS,
  type AssessmentAnswer,
  type AssessmentItem,
  type CefrLevel,
  type ChapterRecord,
  type Mastery,
  type ReviewRating,
  type Route,
  type VocabularyRecord,
  type WorldDraft,
  type WorldRecord,
} from "./types";

export const SNOWPATH_VIEW_TYPE = "snowpath-view";

const ROUTES: Array<{ id: Route; label: string; icon: string }> = [
  { id: "adventure", label: "冒险", icon: "compass" },
  { id: "assessment", label: "评估", icon: "gauge" },
  { id: "vocabulary", label: "词汇", icon: "languages" },
  { id: "review", label: "复习", icon: "gallery-horizontal-end" },
  { id: "history", label: "回看", icon: "book-open" },
  { id: "stats", label: "统计", icon: "chart-no-axes-combined" },
];

const LEVEL_DESCRIPTIONS: Record<CefrLevel, string> = {
  A1: "熟悉单词和非常简单的短句",
  A2: "日常短文和直接描述",
  B1: "熟悉主题文章的主要内容",
  B2: "自然阅读小说与观点文章",
  C1: "复杂长文、隐含态度和风格差异",
  C2: "几乎毫不费力地理解各类英文材料",
};

function iconButton(parent: HTMLElement, icon: string, label: string, handler: () => void): HTMLButtonElement {
  const button = parent.createEl("button", { cls: "snowpath-icon-button", attr: { "aria-label": label, title: label } });
  setIcon(button, icon);
  button.addEventListener("click", handler);
  return button;
}

function actionButton(parent: HTMLElement, text: string, handler: () => void, primary = false): HTMLButtonElement {
  const button = parent.createEl("button", { text, cls: primary ? "snowpath-button is-primary" : "snowpath-button" });
  button.addEventListener("click", handler);
  return button;
}

function emptyState(parent: HTMLElement, title: string, message: string): HTMLElement {
  const state = parent.createDiv({ cls: "snowpath-empty" });
  const mark = state.createDiv({ cls: "snowpath-empty-mark" });
  setIcon(mark, "snowflake");
  state.createEl("h2", { text: title });
  state.createEl("p", { text: message });
  return state;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("zh-CN", { month: "short", day: "numeric" });
}

function sentenceParts(text: string): string[] {
  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
    return Array.from(segmenter.segment(text), (item) => item.segment).filter((item) => item.trim());
  }
  return text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text];
}

export class SnowpathView extends ItemView {
  private route: Route = "adventure";
  private activeWorldId = "";
  private creating = false;
  private creatorMode: "random" | "custom" = "random";
  private randomDirections = new Set<string>(["detective"]);
  private randomProtagonist = "ordinary";
  private randomSetting = "modern";
  private randomDrive = "mystery";
  private randomAudience = "neutral";
  private randomMood = "healing";
  private randomPreview: RandomWorldPreview | null = null;
  private generating = false;
  private generationController: AbortController | null = null;
  private showTranslation = false;
  private chapterStartedAt = Date.now();
  private assessmentStage: "intro" | "quick" | "self" | "quiz" | "dialogue" | "result" = "intro";
  private selfLevel: CefrLevel = "A2";
  private quizTarget: CefrLevel = "A2";
  private quizAnswers: AssessmentAnswer[] = [];
  private quizItem: AssessmentItem | undefined;
  private dialogueAnswers = ["", "", ""];
  private assessmentBusy = false;
  private vocabularySearch = "";
  private vocabularyStatus: Mastery | "all" = "all";
  private reviewOffset = 0;
  private reviewFlipped = false;
  private historyWorldId = "";
  private historyChapter = -1;
  private statsRange = 30;

  constructor(leaf: WorkspaceLeaf, readonly plugin: SnowpathPlugin) {
    super(leaf);
  }

  getViewType(): string { return SNOWPATH_VIEW_TYPE; }
  getDisplayText(): string { return "Snowpath"; }
  getIcon(): string { return "snowflake"; }

  async onOpen(): Promise<void> {
    this.activeWorldId = this.plugin.settings.lastWorldId;
    this.registerDomEvent(document, "keydown", (event) => void this.handleKeyboard(event));
    await this.render();
  }

  async onClose(): Promise<void> {
    this.generationController?.abort();
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  }

  async setRoute(route: Route): Promise<void> {
    this.route = route;
    this.reviewFlipped = false;
    await this.render();
  }

  async requestRefresh(): Promise<void> {
    if (!this.generating && !this.assessmentBusy) await this.render();
  }

  private async render(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("snowpath-root");
    const header = root.createDiv({ cls: "snowpath-header" });
    const brand = header.createEl("button", { cls: "snowpath-brand", attr: { "aria-label": "Snowpath 冒险首页" } });
    const brandMark = brand.createSpan({ cls: "snowpath-brand-mark" });
    setIcon(brandMark, "snowflake");
    brand.createSpan({ text: "Snowpath", cls: "snowpath-brand-name" });
    brand.createSpan({ text: "雪径", cls: "snowpath-brand-cn" });
    brand.addEventListener("click", () => void this.setRoute("adventure"));

    const nav = header.createEl("nav", { cls: "snowpath-nav", attr: { "aria-label": "Snowpath 功能" } });
    for (const item of ROUTES) {
      const button = nav.createEl("button", { cls: `snowpath-nav-item${this.route === item.id ? " is-active" : ""}` });
      const icon = button.createSpan();
      setIcon(icon, item.icon);
      button.createSpan({ text: item.label });
      button.addEventListener("click", () => void this.setRoute(item.id));
    }
    iconButton(header, "settings", "打开 Snowpath 设置", () => this.plugin.openSettings());

    const main = root.createEl("main", { cls: `snowpath-main route-${this.route}` });
    try {
      if (this.route === "adventure") await this.renderAdventure(main);
      else if (this.route === "assessment") await this.renderAssessment(main);
      else if (this.route === "vocabulary") await this.renderVocabulary(main);
      else if (this.route === "review") await this.renderReview(main);
      else if (this.route === "history") await this.renderHistory(main);
      else await this.renderStats(main);
    } catch (error) {
      const state = emptyState(main, "这里没有顺利加载", error instanceof Error ? error.message : String(error));
      actionButton(state, "重新加载", () => void this.render(), true);
    }
  }

  private pageTitle(parent: HTMLElement, eyebrow: string, title: string, subtitle: string): HTMLElement {
    const heading = parent.createDiv({ cls: "snowpath-page-heading" });
    heading.createDiv({ text: eyebrow, cls: "snowpath-eyebrow" });
    heading.createEl("h1", { text: title });
    heading.createEl("p", { text: subtitle });
    return heading;
  }

  private async renderAdventure(main: HTMLElement): Promise<void> {
    if (this.generating) {
      this.renderGenerating(main);
      return;
    }
    if (this.creating) {
      this.renderWorldCreator(main);
      return;
    }
    const worlds = await this.plugin.store.listWorlds();
    if (!this.activeWorldId && worlds[0]) this.activeWorldId = worlds[0].id;
    let world = this.activeWorldId ? await this.plugin.store.loadWorld(this.activeWorldId) : null;
    if (!world && worlds[0]) {
      this.activeWorldId = worlds[0].id;
      world = await this.plugin.store.loadWorld(this.activeWorldId);
    }
    if (!world) {
      const hero = main.createDiv({ cls: "snowpath-hero" });
      hero.createDiv({ text: "COMPREHENSIBLE INPUT · YOUR STORY", cls: "snowpath-eyebrow" });
      hero.createEl("h1", { text: "读进故事里，沿着雪径向前。" });
      hero.createEl("p", { text: "Snowpath 会按你的水平生成一段刚好有一点挑战的英文冒险。每次只需要读一章，再做一个选择。" });
      actionButton(hero, "创建第一个世界", () => { this.creating = true; void this.render(); }, true);
      return;
    }

    const chapters = await this.plugin.store.listChapters(world.id);
    const chapter = chapters.at(-1);
    this.renderWorldHeader(main, world, chapters);
    if (!chapter) {
      const state = emptyState(main, "世界已经准备好", world.premise);
      actionButton(state, "生成开场", () => void this.generateChapter(world, "Begin the story and introduce an immediate, meaningful situation."), true);
      return;
    }
    this.renderChapter(main, world, chapter);
  }

  private renderWorldHeader(main: HTMLElement, world: WorldRecord, chapters: ChapterRecord[]): void {
    const heading = main.createDiv({ cls: "snowpath-world-heading" });
    const copy = heading.createDiv();
    copy.createDiv({ text: `${world.genre.toLocaleUpperCase()} · ${world.cefr}`, cls: "snowpath-eyebrow" });
    copy.createEl("h1", { text: world.title });
    copy.createEl("p", { text: world.premise });
    const actions = heading.createDiv({ cls: "snowpath-inline-actions" });
    actionButton(actions, "所有世界", () => { this.activeWorldId = ""; this.creating = true; void this.render(); });
    actionButton(actions, "新建世界", () => { this.creating = true; void this.render(); });

    const trail = main.createDiv({ cls: "snowpath-trail", attr: { "aria-label": "章节雪径" } });
    const start = Math.max(1, chapters.length - 9);
    for (let chapter = start; chapter <= Math.max(chapters.length, 1); chapter += 1) {
      const node = trail.createDiv({ cls: `snowpath-trail-node${chapter === chapters.length ? " is-current" : ""}` });
      node.createSpan({ text: String(chapter) });
    }
    trail.createDiv({ cls: "snowpath-trail-next", text: "+" });
  }

  private renderChapter(main: HTMLElement, world: WorldRecord, chapter: ChapterRecord): void {
    const toolbar = main.createDiv({ cls: "snowpath-chapter-toolbar" });
    toolbar.createDiv({ text: `CHAPTER ${chapter.chapter} · ${chapter.title}`, cls: "snowpath-chapter-label" });
    const tools = toolbar.createDiv({ cls: "snowpath-inline-actions" });
    actionButton(tools, this.showTranslation ? "隐藏翻译" : "显示翻译", () => { this.showTranslation = !this.showTranslation; void this.render(); });
    iconButton(tools, "volume-2", "朗读全文", () => this.speak(chapter.paragraphs.join(" ")));
    iconButton(tools, "square", "停止朗读", () => speechSynthesis.cancel());

    const layout = main.createDiv({ cls: "snowpath-reading-layout" });
    const story = layout.createEl("article", { cls: "snowpath-story" });
    chapter.paragraphs.forEach((paragraph, index) => {
      const block = story.createDiv({ cls: "snowpath-paragraph" });
      for (const sentence of sentenceParts(paragraph)) {
        const sentenceEl = block.createSpan({ cls: "snowpath-sentence", attr: { role: "button", tabindex: "0", title: "点击朗读这一句" } });
        this.renderHighlightedText(sentenceEl, sentence, chapter.vocabulary);
        sentenceEl.addEventListener("click", () => this.speak(sentence));
        sentenceEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter") this.speak(sentence);
        });
      }
      if (this.showTranslation) block.createEl("p", { text: chapter.translation[index] ?? "", cls: "snowpath-translation" });
    });

    const sidebar = layout.createEl("aside", { cls: "snowpath-word-rail", attr: { "aria-label": "本章生词" } });
    sidebar.createEl("h2", { text: "沿途新词" });
    if (!chapter.vocabulary.length) sidebar.createEl("p", { text: "本章没有新增目标词。", cls: "snowpath-muted" });
    for (const word of chapter.vocabulary) {
      const card = sidebar.createDiv({ cls: "snowpath-mini-word" });
      const row = card.createDiv({ cls: "snowpath-mini-word-title" });
      row.createEl("strong", { text: word.word });
      iconButton(row, "volume-2", `朗读 ${word.word}`, () => this.speak(word.word));
      card.createDiv({ text: word.meaningZh, cls: "snowpath-word-meaning" });
      card.createDiv({ text: `${word.partOfSpeech} · ${word.cefr}`, cls: "snowpath-word-meta" });
      card.createEl("p", { text: word.definitionEn });
    }

    const decision = main.createDiv({ cls: "snowpath-decision" });
    decision.createEl("h2", { text: "你准备怎么做？" });
    for (const choice of chapter.choices) {
      const button = decision.createEl("button", { cls: "snowpath-choice" });
      button.createSpan({ text: choice.id, cls: "snowpath-choice-key" });
      button.createSpan({ text: choice.text, cls: "snowpath-choice-text" });
      button.createSpan({ text: choice.difficulty === "easier" ? "更轻松" : choice.difficulty === "harder" ? "更挑战" : "刚刚好", cls: `snowpath-difficulty is-${choice.difficulty}` });
      button.addEventListener("click", () => void this.generateChapter(world, choice.text));
    }
    const custom = decision.createDiv({ cls: "snowpath-custom-action" });
    const input = custom.createEl("input", { type: "text", placeholder: "或者，写下你自己的行动…", attr: { maxlength: "1000" } });
    const send = actionButton(custom, "继续故事", () => {
      const value = input.value.trim();
      if (!value) { new Notice("先写下你想做的行动"); return; }
      void this.generateChapter(world, value);
    }, true);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) send.click();
    });
  }

  private renderHighlightedText(parent: HTMLElement, text: string, vocabulary: ChapterRecord["vocabulary"]): void {
    const words = vocabulary.map((item) => item.word).filter(Boolean).sort((a, b) => b.length - a.length);
    if (!words.length) { parent.appendText(text); return; }
    const escaped = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const pattern = new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
    for (const part of text.split(pattern)) {
      const word = vocabulary.find((item) => item.word.toLocaleLowerCase("en-US") === part.toLocaleLowerCase("en-US"));
      if (word) {
        const mark = parent.createEl("mark", { text: part, cls: "snowpath-highlight", attr: { title: `${word.meaningZh} · ${word.cefr}` } });
        mark.addEventListener("click", (event) => { event.stopPropagation(); this.speak(word.word); });
      } else parent.appendText(part);
    }
  }

  private renderGenerating(main: HTMLElement): void {
    const state = main.createDiv({ cls: "snowpath-generating" });
    const orb = state.createDiv({ cls: "snowpath-generating-orb" });
    setIcon(orb, "snowflake");
    state.createDiv({ text: "正在让下一段雪径显现…", cls: "snowpath-generating-title" });
    state.createEl("p", { text: `${this.plugin.ai.providerLabel()} 正在续写故事、整理伏笔并挑选 i+1 词汇。` });
    actionButton(state, "取消生成", () => this.generationController?.abort());
  }

  private async generateChapter(world: WorldRecord, action: string): Promise<void> {
    if (!this.plugin.ai.isConfigured()) {
      new Notice("先在 Snowpath 设置中完成 AI 配置", 6000);
      this.plugin.openSettings();
      return;
    }
    this.generating = true;
    this.generationController = new AbortController();
    await this.render();
    try {
      const [chapters, vocabulary] = await Promise.all([
        this.plugin.store.listChapters(world.id),
        this.plugin.store.listVocabulary(),
      ]);
      const targetWords = vocabulary
        .filter((word) => word.mastery !== "mastered" && levelIndex(word.cefr) <= Math.min(CEFR_LEVELS.length - 1, levelIndex(world.cefr) + 1))
        .sort((a, b) => a.encounterCount - b.encounterCount || a.review.dueAt.localeCompare(b.review.dueAt))
        .map((word) => word.word);
      const response = await this.plugin.ai.generateStory({
        world,
        recentChapters: chapters.map((item) => ({ chapter: item.chapter, story: item.paragraphs.join(" "), selectedAction: item.selectedAction })),
        targetWords,
        action,
        wordsPerChapter: this.plugin.settings.wordsPerChapter,
      }, this.generationController.signal);
      if (this.generationController.signal.aborted) return;
      const readingSeconds = Math.max(0, Math.round((Date.now() - this.chapterStartedAt) / 1000));
      await this.plugin.store.saveChapter(world, response, action, readingSeconds);
      this.plugin.settings.lastWorldId = world.id;
      await this.plugin.saveSettings();
      this.chapterStartedAt = Date.now();
      this.showTranslation = false;
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error), 9000);
    } finally {
      this.generating = false;
      this.generationController = null;
      await this.render();
    }
  }

  private renderWorldCreator(main: HTMLElement): void {
    const heading = this.pageTitle(main, "CHOOSE A BEGINNING", "创建新世界", "选择一个起点。故事会在你的决定中继续生长。");
    actionButton(heading, "返回冒险", () => { this.creating = false; void this.render(); });
    const modes = main.createDiv({ cls: "snowpath-mode-tabs" });
    ([ ["random", "组合创作"], ["custom", "完全自定义"] ] as const).forEach(([id, label]) => {
      const button = modes.createEl("button", { text: label, cls: this.creatorMode === id ? "is-active" : "" });
      button.addEventListener("click", () => { this.creatorMode = id; this.randomPreview = null; void this.render(); });
    });
    const level = this.plugin.settings.assessment?.level ?? "A2";
    if (this.creatorMode === "random") {
      const composer = main.createDiv({ cls: "snowpath-story-composer" });
      const intro = composer.createDiv({ cls: "snowpath-composer-heading" });
      const copy = intro.createDiv();
      copy.createDiv({ text: "MIX A NEW PATH", cls: "snowpath-eyebrow" });
      copy.createEl("h2", { text: "组合一个从未走过的世界" });
      copy.createEl("p", { text: "题材可选 1–5 个；其余创作维度各选一个。", cls: "snowpath-muted" });
      actionButton(intro, "随机组合", () => this.randomizeStoryMix());
      const group = (title: string, hint: string, options: StoryMixOption[], selected: (id: string) => boolean, onSelect: (id: string) => void) => {
        const section = composer.createDiv({ cls: "snowpath-mix-group" });
        const label = section.createDiv({ cls: "snowpath-mix-label" });
        label.createEl("strong", { text: title });
        label.createSpan({ text: hint });
        const choices = section.createDiv({ cls: "snowpath-mix-options" });
        options.forEach((option) => {
          const active = selected(option.id);
          const button = choices.createEl("button", { text: option.label, cls: `snowpath-mix-chip${active ? " is-selected" : ""}`, attr: { "aria-pressed": String(active) } });
          button.addEventListener("click", () => onSelect(option.id));
        });
      };
      group("故事方向", "可多选，最多 5 个", STORY_DIRECTIONS, (id) => this.randomDirections.has(id), (id) => {
        if (this.randomDirections.has(id)) {
          if (this.randomDirections.size === 1) { new Notice("至少保留一个故事方向"); return; }
          this.randomDirections.delete(id);
        } else {
          if (this.randomDirections.size >= MAX_STORY_DIRECTIONS) { new Notice("最多组合五个故事方向"); return; }
          this.randomDirections.add(id);
        }
        this.randomPreview = null;
        void this.render();
      });
      group("主角身份", "决定从谁的视角进入故事", STORY_PROTAGONISTS, (id) => this.randomProtagonist === id, (id) => { this.randomProtagonist = id; this.randomPreview = null; void this.render(); });
      group("世界舞台", "决定故事发生在哪里", STORY_SETTINGS, (id) => this.randomSetting === id, (id) => { this.randomSetting = id; this.randomPreview = null; void this.render(); });
      group("剧情驱动力", "决定故事长期围绕什么展开", STORY_DRIVES, (id) => this.randomDrive === id, (id) => { this.randomDrive = id; this.randomPreview = null; void this.render(); });
      group("受众倾向", "决定主角与叙事关注点", STORY_AUDIENCES, (id) => this.randomAudience === id, (id) => { this.randomAudience = id; this.randomPreview = null; void this.render(); });
      group("故事氛围", "决定阅读时的情绪质感", STORY_MOODS, (id) => this.randomMood === id, (id) => { this.randomMood = id; this.randomPreview = null; void this.render(); });
      const selectedLabels = STORY_DIRECTIONS.filter((item) => this.randomDirections.has(item.id)).map((item) => item.label);
      const summary = composer.createDiv({ cls: "snowpath-mix-summary" });
      summary.createSpan({ text: selectedLabels.join(" × ") });
      summary.createSpan({ text: STORY_PROTAGONISTS.find((item) => item.id === this.randomProtagonist)?.label ?? "普通人" });
      summary.createSpan({ text: STORY_SETTINGS.find((item) => item.id === this.randomSetting)?.label ?? "现代都市" });
      summary.createSpan({ text: STORY_DRIVES.find((item) => item.id === this.randomDrive)?.label ?? "解开谜团" });
      summary.createSpan({ text: STORY_AUDIENCES.find((item) => item.id === this.randomAudience)?.label ?? "不限" });
      summary.createSpan({ text: STORY_MOODS.find((item) => item.id === this.randomMood)?.label ?? "轻松治愈" });
      if (this.randomPreview) {
        const preview = composer.createDiv({ cls: "snowpath-outline-preview" });
        preview.createDiv({ text: `OUTLINE PREVIEW · ${this.randomPreview.draft.seed?.toUpperCase()}`, cls: "snowpath-eyebrow" });
        preview.createEl("h3", { text: this.randomPreview.draft.title });
        preview.createEl("p", { text: this.randomPreview.outlineZh });
        const details = preview.createEl("details");
        details.createEl("summary", { text: "查看英文世界设定" });
        details.createEl("p", { text: this.randomPreview.draft.premise });
      }
      const actions = composer.createDiv({ cls: "snowpath-composer-actions" });
      actionButton(actions, this.randomPreview ? "换一个大纲" : "预览故事大纲", () => {
        const seed = Math.random().toString(36).slice(2, 10);
        this.randomPreview = createRandomWorldPreview({ directions: [...this.randomDirections], protagonist: this.randomProtagonist, setting: this.randomSetting, drive: this.randomDrive, audience: this.randomAudience, mood: this.randomMood }, seed, level);
        void this.render();
      }, !this.randomPreview);
      if (this.randomPreview) actionButton(actions, "创建这个世界", () => void this.createWorld(this.randomPreview!.draft), true);
    } else {
      const form = main.createDiv({ cls: "snowpath-create-form" });
      const title = this.field(form, "世界名称", "例如：午夜图书馆", 80);
      const premise = this.field(form, "故事设定", "主角是谁、身处哪里、眼前有什么问题？", 800, true);
      const genre = this.field(form, "类型", "mystery / fantasy / slice of life", 80);
      const tone = this.field(form, "氛围", "hopeful, tense, witty…", 80);
      const row = form.createDiv({ cls: "snowpath-form-row" });
      row.createEl("label", { text: "英文难度" });
      const select = row.createEl("select");
      CEFR_LEVELS.forEach((item) => select.createEl("option", { text: item, value: item }));
      select.value = level;
      actionButton(form, "创建世界", () => {
        if (!title.value.trim() || !premise.value.trim()) { new Notice("世界名称和故事设定不能为空"); return; }
        void this.createWorld({ title: title.value.trim(), premise: premise.value.trim(), genre: genre.value.trim() || "adventure", tone: tone.value.trim() || "hopeful", cefr: select.value as CefrLevel });
      }, true);
    }
  }

  private randomizeStoryMix(): void {
    const count = 1 + Math.floor(Math.random() * MAX_STORY_DIRECTIONS);
    const directions = new Set<string>();
    while (directions.size < count) {
      const option = STORY_DIRECTIONS[Math.floor(Math.random() * STORY_DIRECTIONS.length)];
      if (option) directions.add(option.id);
    }
    this.randomDirections = directions;
    this.randomProtagonist = STORY_PROTAGONISTS[Math.floor(Math.random() * STORY_PROTAGONISTS.length)]?.id ?? "ordinary";
    this.randomSetting = STORY_SETTINGS[Math.floor(Math.random() * STORY_SETTINGS.length)]?.id ?? "modern";
    this.randomDrive = STORY_DRIVES[Math.floor(Math.random() * STORY_DRIVES.length)]?.id ?? "mystery";
    this.randomAudience = STORY_AUDIENCES[Math.floor(Math.random() * STORY_AUDIENCES.length)]?.id ?? "neutral";
    this.randomMood = STORY_MOODS[Math.floor(Math.random() * STORY_MOODS.length)]?.id ?? "healing";
    this.randomPreview = null;
    void this.render();
  }

  private field(parent: HTMLElement, label: string, placeholder: string, maxLength: number, multiline = false): HTMLInputElement | HTMLTextAreaElement {
    const row = parent.createDiv({ cls: "snowpath-form-row" });
    row.createEl("label", { text: label });
    return multiline
      ? row.createEl("textarea", { placeholder, attr: { maxlength: String(maxLength), rows: "5" } })
      : row.createEl("input", { type: "text", placeholder, attr: { maxlength: String(maxLength) } });
  }

  private async createWorld(draft: WorldDraft): Promise<void> {
    const world = await this.plugin.store.createWorld(draft);
    this.activeWorldId = world.id;
    this.plugin.settings.lastWorldId = world.id;
    await this.plugin.saveSettings();
    this.randomPreview = null;
    this.creating = false;
    await this.render();
  }

  private async renderAssessment(main: HTMLElement): Promise<void> {
    if (this.assessmentStage === "intro") {
      this.pageTitle(main, "FIND YOUR I", "英语水平评估", "三步得到 A1–C2 学习难度参考：自评、12 题自适应测试、AI 文字表达评估。");
      if (this.plugin.settings.assessment) this.renderAssessmentResult(main, this.plugin.settings.assessment.level);
      else {
        const state = emptyState(main, "从你读得懂的地方出发", "结果只用于控制故事难度，不是正式 CEFR 认证。全程约 8 分钟。");
        actionButton(state, "开始评估", () => { this.assessmentStage = "self"; void this.render(); }, true);
        actionButton(state, "不答题，直接选难度", () => { this.assessmentStage = "quick"; void this.render(); });
      }
      return;
    }
    if (this.assessmentStage === "quick") { this.renderQuickLevelSelection(main); return; }
    if (this.assessmentStage === "self") { this.renderSelfAssessment(main); return; }
    if (this.assessmentStage === "quiz") { this.renderQuiz(main); return; }
    if (this.assessmentStage === "dialogue") { this.renderDialogue(main); return; }
    this.renderAssessmentResult(main, this.plugin.settings.assessment?.level ?? "A1");
  }

  private renderSelfAssessment(main: HTMLElement): void {
    this.pageTitle(main, "STEP 1 / 3", "先从直觉开始", "选择最接近你当前阅读体验的描述。");
    this.renderLevelCards(main, (level) => {
      this.selfLevel = level;
      this.quizTarget = level;
      this.quizAnswers = [];
      this.quizItem = pickAssessmentItem(level, new Set());
      this.assessmentStage = "quiz";
      void this.render();
    });
  }

  private renderQuickLevelSelection(main: HTMLElement): void {
    const heading = this.pageTitle(main, "SKIP THE TEST", "直接选择故事难度", "无需答题。选择后，当前冒险的后续章节和新世界都会使用这个难度。");
    actionButton(heading, "返回评估", () => { this.assessmentStage = "intro"; void this.render(); });
    this.renderLevelCards(main, (level) => void this.chooseLevel(level));
  }

  private renderLevelCards(main: HTMLElement, onSelect: (level: CefrLevel) => void): void {
    const grid = main.createDiv({ cls: "snowpath-level-grid" });
    CEFR_LEVELS.forEach((level) => {
      const card = grid.createEl("button", { cls: "snowpath-level-card" });
      card.createEl("strong", { text: level });
      card.createEl("span", { text: LEVEL_DESCRIPTIONS[level] });
      card.addEventListener("click", () => onSelect(level));
    });
  }

  private async chooseLevel(level: CefrLevel): Promise<void> {
    const worldId = this.activeWorldId || this.plugin.settings.lastWorldId;
    const world = worldId ? await this.plugin.store.loadWorld(worldId) : null;
    if (world) {
      world.cefr = level;
      world.updatedAt = new Date().toISOString();
      await this.plugin.store.updateWorld(world);
    }
    this.plugin.settings.assessment = { level, selfLevel: level, quizLevel: level, updatedAt: new Date().toISOString() };
    await this.plugin.saveSettings();
    this.assessmentStage = "result";
    new Notice(`故事难度已设为 ${level}`);
    await this.render();
  }

  private renderQuiz(main: HTMLElement): void {
    const item = this.quizItem;
    if (!item) { new Notice("题库不足，无法继续评估"); return; }
    this.pageTitle(main, `STEP 2 / 3 · ${this.quizAnswers.length + 1} / 12`, "自适应测试", "答对后题目会变难，答错后会回到更合适的梯度。");
    const card = main.createDiv({ cls: "snowpath-quiz-card" });
    card.createDiv({ text: item.level, cls: "snowpath-level-badge" });
    card.createEl("h2", { text: item.prompt });
    const options = card.createDiv({ cls: "snowpath-quiz-options" });
    item.options.forEach((option, index) => {
      const button = options.createEl("button", { cls: "snowpath-quiz-option" });
      button.createSpan({ text: String.fromCharCode(65 + index), cls: "snowpath-choice-key" });
      button.createSpan({ text: option });
      button.addEventListener("click", () => this.answerQuiz(index));
    });
  }

  private answerQuiz(answer: number): void {
    if (!this.quizItem) return;
    const correct = answer === this.quizItem.answer;
    this.quizAnswers.push({ item: this.quizItem, correct });
    this.quizTarget = nextAdaptiveTarget(this.quizItem.level, correct);
    if (this.quizAnswers.length >= 12) {
      this.assessmentStage = "dialogue";
      void this.render();
      return;
    }
    this.quizItem = pickAssessmentItem(this.quizTarget, new Set(this.quizAnswers.map((item) => item.item.id)));
    void this.render();
  }

  private renderDialogue(main: HTMLElement): void {
    const quizLevel = computeQuizLevel(this.quizAnswers);
    this.pageTitle(main, "STEP 3 / 3", "用英文表达三个想法", `AI 将以 ${quizLevel} 附近的标准评估清晰度、词汇、语法和连贯性。`);
    const prompts = [
      "Describe a place where you feel comfortable, and explain why.",
      "Tell us about a difficult problem you faced and what you did next.",
      "If you could change one decision from your past, what would you change and why?",
    ];
    const form = main.createDiv({ cls: "snowpath-dialogue" });
    prompts.forEach((prompt, index) => {
      const row = form.createDiv({ cls: "snowpath-dialogue-row" });
      row.createEl("label", { text: `${index + 1}. ${prompt}` });
      const input = row.createEl("textarea", { attr: { rows: "4", maxlength: "1600" } });
      input.value = this.dialogueAnswers[index] ?? "";
      input.addEventListener("input", () => { this.dialogueAnswers[index] = input.value; });
    });
    const actions = form.createDiv({ cls: "snowpath-inline-actions" });
    const submit = actionButton(actions, this.assessmentBusy ? "评估中…" : "让 AI 评估", () => void this.finishAssessmentWithAi(), true);
    submit.disabled = this.assessmentBusy;
    actionButton(actions, "跳过 AI 表达评估", () => void this.finishAssessment());
  }

  private async finishAssessmentWithAi(): Promise<void> {
    if (this.dialogueAnswers.some((answer) => answer.trim().length < 15)) {
      new Notice("请为三个问题各写至少一句完整回答");
      return;
    }
    if (!this.plugin.ai.isConfigured()) {
      new Notice("AI 尚未配置；可以先跳过这一阶段，或前往设置完成配置");
      return;
    }
    this.assessmentBusy = true;
    await this.render();
    try {
      const quizLevel = computeQuizLevel(this.quizAnswers);
      const dialogueLevel = await this.plugin.ai.assessDialogue(this.dialogueAnswers, quizLevel);
      await this.finishAssessment(dialogueLevel);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error), 8000);
    } finally {
      this.assessmentBusy = false;
      await this.render();
    }
  }

  private async finishAssessment(dialogueLevel?: CefrLevel): Promise<void> {
    const quizLevel = computeQuizLevel(this.quizAnswers);
    this.plugin.settings.assessment = scoreAssessment(this.selfLevel, quizLevel, dialogueLevel);
    await this.plugin.saveSettings();
    this.assessmentStage = "result";
    await this.render();
  }

  private renderAssessmentResult(main: HTMLElement, level: CefrLevel): void {
    const result = main.createDiv({ cls: "snowpath-assessment-result" });
    result.createDiv({ text: "YOUR CURRENT PATH", cls: "snowpath-eyebrow" });
    result.createDiv({ text: level, cls: "snowpath-result-level" });
    result.createEl("h2", { text: `下一段故事将以 ${level} 为基础` });
    result.createEl("p", { text: "故事会加入少量高于当前水平的词汇。这个结果只用于调整学习材料，不是正式 CEFR 认证。" });
    const actions = result.createDiv({ cls: "snowpath-inline-actions" });
    actionButton(actions, "开始冒险", () => void this.setRoute("adventure"), true);
    actionButton(actions, "重新评估", () => { this.assessmentStage = "self"; void this.render(); });
    actionButton(actions, "直接修改难度", () => { this.assessmentStage = "quick"; void this.render(); });
  }

  private async renderVocabulary(main: HTMLElement): Promise<void> {
    const words = await this.plugin.store.listVocabulary();
    const counts = Object.fromEntries(["new", "learning", "familiar", "mastered"].map((status) => [status, words.filter((word) => word.mastery === status).length])) as Record<Mastery, number>;
    const heading = this.pageTitle(main, `${words.length} WORDS ON YOUR PATH`, "词汇中心", "每个词都保留它第一次出现的故事语境，并在后续冒险中再次遇见。");
    actionButton(heading, "导入词表", () => new ImportVocabularyModal(this.app, this.plugin).open(), true);
    const summary = main.createDiv({ cls: "snowpath-status-strip" });
    ([ ["new", "新词"], ["learning", "学习中"], ["familiar", "熟悉"], ["mastered", "已掌握"] ] as const).forEach(([id, label]) => {
      summary.createDiv({ text: `${counts[id]} ${label}`, cls: `snowpath-status is-${id}` });
    });
    const toolbar = main.createDiv({ cls: "snowpath-filterbar" });
    const search = toolbar.createEl("input", { type: "search", placeholder: "搜索单词或释义…" });
    search.value = this.vocabularySearch;
    search.addEventListener("change", () => { this.vocabularySearch = search.value.trim().toLocaleLowerCase(); void this.render(); });
    const status = toolbar.createEl("select", { attr: { "aria-label": "按掌握状态筛选" } });
    ([ ["all", "全部状态"], ["new", "新词"], ["learning", "学习中"], ["familiar", "熟悉"], ["mastered", "已掌握"] ] as const).forEach(([value, label]) => status.createEl("option", { value, text: label }));
    status.value = this.vocabularyStatus;
    status.addEventListener("change", () => { this.vocabularyStatus = status.value as Mastery | "all"; void this.render(); });

    const filtered = words.filter((word) => {
      const matchesStatus = this.vocabularyStatus === "all" || word.mastery === this.vocabularyStatus;
      const haystack = `${word.word} ${word.meaningZh} ${word.definitionEn}`.toLocaleLowerCase();
      return matchesStatus && (!this.vocabularySearch || haystack.includes(this.vocabularySearch));
    });
    if (!filtered.length) {
      const state = emptyState(main, words.length ? "没有匹配的词" : "还没有沿途新词", words.length ? "调整搜索或筛选条件。" : "生成第一章故事，或导入一份自己的词表。");
      if (!words.length) actionButton(state, "导入词表", () => new ImportVocabularyModal(this.app, this.plugin).open());
      return;
    }
    const list = main.createDiv({ cls: "snowpath-vocabulary-list" });
    for (const word of filtered.slice(0, 240)) {
      const card = list.createEl("article", { cls: "snowpath-word-card" });
      const head = card.createDiv({ cls: "snowpath-word-card-head" });
      head.createEl("h2", { text: word.word });
      iconButton(head, "volume-2", `朗读 ${word.word}`, () => this.speak(word.word));
      head.createSpan({ text: word.mastery, cls: `snowpath-status is-${word.mastery}` });
      card.createDiv({ text: word.meaningZh || "待在故事中补充释义", cls: "snowpath-word-meaning" });
      card.createEl("p", { text: word.definitionEn || "This word has not appeared in a generated chapter yet." });
      const meta = card.createDiv({ cls: "snowpath-word-meta" });
      meta.createSpan({ text: `${word.partOfSpeech} · ${word.cefr}` });
      meta.createSpan({ text: `遇见 ${word.encounterCount} 次` });
      meta.createSpan({ text: `下次 ${formatDate(word.review.dueAt)}` });
      if (word.sentence) card.createEl("blockquote", { text: word.sentence });
    }
    if (filtered.length > 240) main.createEl("p", { text: `当前显示前 240 个，共 ${filtered.length} 个匹配结果。`, cls: "snowpath-muted" });
  }

  private async renderReview(main: HTMLElement): Promise<void> {
    const now = new Date().toISOString();
    const queue = (await this.plugin.store.listVocabulary())
      .filter((word) => word.mastery !== "mastered" && word.review.dueAt <= now)
      .sort((a, b) => a.review.dueAt.localeCompare(b.review.dueAt));
    this.pageTitle(main, "SPACED RECALL", "今日复习", "空格翻面，方向键换卡，数字 1–4 评分。");
    if (!queue.length) {
      emptyState(main, "今天的卡片已经走完", "继续读一章故事，新的词会在下一次合适的时间出现。");
      return;
    }
    this.reviewOffset = Math.max(0, Math.min(this.reviewOffset, queue.length - 1));
    const word = queue[this.reviewOffset];
    if (!word) return;
    const progress = main.createDiv({ cls: "snowpath-review-progress" });
    progress.createSpan({ text: `${this.reviewOffset + 1} / ${queue.length}` });
    progress.createSpan({ text: `连续复习 ${word.review.repetitions} 次` });
    const card = main.createEl("button", { cls: `snowpath-flashcard${this.reviewFlipped ? " is-flipped" : ""}`, attr: { "aria-label": "闪卡，点击翻面" } });
    if (!this.reviewFlipped) {
      card.createDiv({ text: "WORD", cls: "snowpath-eyebrow" });
      card.createDiv({ text: word.word, cls: "snowpath-flash-word" });
      card.createDiv({ text: "点击或按空格查看释义", cls: "snowpath-muted" });
    } else {
      card.createDiv({ text: `${word.partOfSpeech} · ${word.cefr}`, cls: "snowpath-eyebrow" });
      card.createDiv({ text: word.meaningZh || "待补充释义", cls: "snowpath-flash-meaning" });
      card.createEl("p", { text: word.definitionEn });
      if (word.sentence) card.createEl("blockquote", { text: word.sentence });
    }
    card.addEventListener("click", () => { this.reviewFlipped = !this.reviewFlipped; void this.render(); });
    const navigation = main.createDiv({ cls: "snowpath-review-nav" });
    actionButton(navigation, "← 上一张", () => { this.reviewOffset = (this.reviewOffset - 1 + queue.length) % queue.length; this.reviewFlipped = false; void this.render(); });
    iconButton(navigation, "volume-2", `朗读 ${word.word}`, () => this.speak(word.word));
    actionButton(navigation, "下一张 →", () => { this.reviewOffset = (this.reviewOffset + 1) % queue.length; this.reviewFlipped = false; void this.render(); });
    if (this.reviewFlipped) {
      const ratings = main.createDiv({ cls: "snowpath-ratings" });
      ([ ["again", "1 · 重来"], ["hard", "2 · 困难"], ["good", "3 · 记得"], ["easy", "4 · 轻松"] ] as const).forEach(([rating, label]) => {
        actionButton(ratings, label, () => void this.rateWord(word, rating), rating === "good");
      });
    }
  }

  private async rateWord(word: VocabularyRecord, rating: ReviewRating): Promise<void> {
    word.review = scheduleReview(word.review, rating);
    await this.plugin.store.recordReview(word, rating);
    this.reviewOffset = 0;
    this.reviewFlipped = false;
    await this.render();
  }

  private async renderHistory(main: HTMLElement): Promise<void> {
    const worlds = await this.plugin.store.listWorlds();
    this.pageTitle(main, "WHAT THE PATH REMEMBERS", "剧情回看", "章节笔记是故事的真实记录；重启 Obsidian 后仍可继续阅读。");
    if (!worlds.length) { emptyState(main, "还没有故事记录", "创建一个世界并生成开场后，章节会出现在这里。"); return; }
    if (!this.historyWorldId) this.historyWorldId = worlds[0]?.id ?? "";
    const selector = main.createDiv({ cls: "snowpath-history-worlds" });
    worlds.forEach((world) => {
      const button = selector.createEl("button", { text: world.title, cls: world.id === this.historyWorldId ? "is-active" : "" });
      button.addEventListener("click", () => { this.historyWorldId = world.id; this.historyChapter = -1; void this.render(); });
    });
    const chapters = await this.plugin.store.listChapters(this.historyWorldId);
    if (!chapters.length) { emptyState(main, "这个世界尚未开篇", "回到冒险页生成第一章。"); return; }
    if (this.historyChapter < 0 || this.historyChapter >= chapters.length) this.historyChapter = chapters.length - 1;
    const layout = main.createDiv({ cls: "snowpath-history-layout" });
    const toc = layout.createEl("aside", { cls: "snowpath-history-toc" });
    chapters.forEach((chapter, index) => {
      const button = toc.createEl("button", { cls: index === this.historyChapter ? "is-active" : "" });
      button.createSpan({ text: String(chapter.chapter).padStart(2, "0") });
      button.createSpan({ text: chapter.title });
      button.addEventListener("click", () => { this.historyChapter = index; void this.render(); });
    });
    const selected = chapters[this.historyChapter];
    if (!selected) return;
    const article = layout.createEl("article", { cls: "snowpath-history-story" });
    article.createDiv({ text: `CHAPTER ${selected.chapter}`, cls: "snowpath-eyebrow" });
    article.createEl("h2", { text: selected.title });
    selected.paragraphs.forEach((paragraph) => article.createEl("p", { text: paragraph }));
    const translation = article.createEl("details");
    translation.createEl("summary", { text: "查看中文翻译" });
    selected.translation.forEach((paragraph) => translation.createEl("p", { text: paragraph }));
    article.createEl("blockquote", { text: `你的选择：${selected.selectedAction}` });
  }

  private async renderStats(main: HTMLElement): Promise<void> {
    const [progress, words] = await Promise.all([
      this.plugin.store.listProgress(this.statsRange),
      this.plugin.store.listVocabulary(),
    ]);
    const heading = this.pageTitle(main, "VISIBLE COMPOUNDING", "学习进度", "不追求每天打卡，只记录真正读过、遇见过和复习过的内容。");
    const ranges = heading.createDiv({ cls: "snowpath-range-tabs" });
    [7, 30, 90].forEach((days) => {
      const button = ranges.createEl("button", { text: `${days} 天`, cls: days === this.statsRange ? "is-active" : "" });
      button.addEventListener("click", () => { this.statsRange = days; void this.render(); });
    });
    const totals = aggregateProgress(progress);
    const mastered = words.filter((word) => word.mastery === "mastered").length;
    const cards = main.createDiv({ cls: "snowpath-metric-grid" });
    this.metric(cards, "阅读时长", `${Math.round(totals.readingSeconds / 60)} 分钟`, "timer");
    this.metric(cards, "完成章节", String(totals.chapters), "milestone");
    this.metric(cards, "词汇积累", String(words.length), "languages");
    this.metric(cards, "已掌握", String(mastered), "badge-check");
    this.metric(cards, "完成复习", String(totals.reviews), "repeat-2");
    this.metric(cards, "连续学习", `${totals.streak} 天`, "flame");
    const panel = main.createDiv({ cls: "snowpath-chart-panel" });
    panel.createEl("h2", { text: "沿途词汇" });
    panel.createEl("p", { text: `最近 ${this.statsRange} 天每天遇见的目标词`, cls: "snowpath-muted" });
    this.renderLineChart(panel, progress.map((day) => ({ label: day.date.slice(5), value: day.wordsEncountered })));
    const distribution = main.createDiv({ cls: "snowpath-distribution" });
    distribution.createEl("h2", { text: "掌握分布" });
    ([ ["new", "新词"], ["learning", "学习中"], ["familiar", "熟悉"], ["mastered", "已掌握"] ] as const).forEach(([status, label]) => {
      const count = words.filter((word) => word.mastery === status).length;
      const row = distribution.createDiv({ cls: "snowpath-distribution-row" });
      row.createSpan({ text: label });
      const track = row.createDiv({ cls: "snowpath-distribution-track" });
      const fill = track.createDiv({ cls: `snowpath-distribution-fill is-${status}` });
      fill.style.width = `${words.length ? Math.max(2, count / words.length * 100) : 0}%`;
      row.createEl("strong", { text: String(count) });
    });
  }

  private metric(parent: HTMLElement, label: string, value: string, icon: string): void {
    const card = parent.createDiv({ cls: "snowpath-metric" });
    const mark = card.createDiv({ cls: "snowpath-metric-icon" });
    setIcon(mark, icon);
    card.createDiv({ text: label, cls: "snowpath-metric-label" });
    card.createDiv({ text: value, cls: "snowpath-metric-value" });
  }

  private renderLineChart(parent: HTMLElement, points: Array<{ label: string; value: number }>): void {
    if (!points.length || points.every((point) => point.value === 0)) {
      parent.createDiv({ text: "这一段雪径还没有词汇记录。", cls: "snowpath-chart-empty" });
      return;
    }
    const width = 720;
    const height = 180;
    const padding = 24;
    const max = Math.max(...points.map((point) => point.value), 1);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "每日词汇增长折线图");
    svg.classList.add("snowpath-line-chart");
    const coords = points.map((point, index) => {
      const x = padding + index * ((width - padding * 2) / Math.max(1, points.length - 1));
      const y = height - padding - point.value / max * (height - padding * 2);
      return `${x},${y}`;
    }).join(" ");
    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.setAttribute("points", coords);
    line.setAttribute("fill", "none");
    line.setAttribute("class", "snowpath-chart-line");
    svg.appendChild(line);
    parent.appendChild(svg);
  }

  private speak(text: string): void {
    if (typeof speechSynthesis === "undefined") { new Notice("当前系统不支持语音朗读"); return; }
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = preferredEnglishVoices(speechSynthesis.getVoices());
    const voice = voices.find((item) => item.name === this.plugin.settings.ttsVoice) ?? voices[0];
    utterance.lang = voice?.lang ?? "en-US";
    utterance.rate = Math.min(1.1, Math.max(0.8, this.plugin.settings.ttsRate));
    utterance.pitch = 1;
    utterance.volume = 1;
    if (voice) utterance.voice = voice;
    speechSynthesis.speak(utterance);
  }

  private async handleKeyboard(event: KeyboardEvent): Promise<void> {
    if (this.route !== "review" || (event.target instanceof HTMLInputElement) || (event.target instanceof HTMLTextAreaElement)) return;
    const words = (await this.plugin.store.listVocabulary()).filter((word) => word.mastery !== "mastered" && word.review.dueAt <= new Date().toISOString());
    if (!words.length) return;
    if (event.key === " ") {
      event.preventDefault();
      this.reviewFlipped = !this.reviewFlipped;
      await this.render();
    } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      this.reviewOffset = (this.reviewOffset + (event.key === "ArrowRight" ? 1 : -1) + words.length) % words.length;
      this.reviewFlipped = false;
      await this.render();
    } else if (this.reviewFlipped && ["1", "2", "3", "4"].includes(event.key)) {
      const rating = ({ "1": "again", "2": "hard", "3": "good", "4": "easy" } as const)[event.key as "1" | "2" | "3" | "4"];
      const word = words[this.reviewOffset];
      if (word) await this.rateWord(word, rating);
    }
  }
}

export class ImportVocabularyModal extends Modal {
  constructor(app: App, private readonly plugin: SnowpathPlugin) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("snowpath-import-modal");
    contentEl.createEl("h2", { text: "导入目标词汇" });
    contentEl.createEl("p", { text: "粘贴每行一个单词，也支持“word, 中文释义”、Markdown 列表或表格。可以额外读取 vault 内的一篇笔记。" });
    let notePath = "";
    let pasted = "";
    new Setting(contentEl).setName("Vault 笔记路径").setDesc("可选，例如 3-资源/英语/四级词汇.md").addText((text) => text.onChange((value) => { notePath = value.trim(); }));
    const field = contentEl.createEl("textarea", { attr: { rows: "12" }, placeholder: "resilient, 有韧性的\nsubtle, 微妙的\n…" });
    field.addEventListener("input", () => { pasted = field.value; });
    new Setting(contentEl).addButton((button) => button.setButtonText("导入词汇").setCta().onClick(async () => {
      let source = pasted;
      if (notePath) {
        const file = this.app.vault.getAbstractFileByPath(notePath);
        if (!(file instanceof TFile)) { new Notice("没有找到指定的 vault 笔记"); return; }
        source += `\n${await this.app.vault.cachedRead(file)}`;
      }
      const items = parseWordList(source);
      if (!items.length) { new Notice("没有识别到可导入的单词"); return; }
      button.setDisabled(true).setButtonText("导入中…");
      const count = await this.plugin.store.importVocabulary(items, this.plugin.settings.assessment?.level ?? "A2");
      new Notice(`已导入 ${count} 个词汇`);
      this.close();
      await this.plugin.openRoute("vocabulary");
    }));
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
