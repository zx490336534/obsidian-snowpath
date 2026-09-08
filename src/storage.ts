import { App, normalizePath, parseYaml, stringifyYaml, TFile } from "obsidian";
import { randomUUID } from "crypto";
import { localDateKey, masteryForReview, normalizeWord, reconcileWorldFromChapters, wordFileName } from "./core";
import type {
  ChapterRecord,
  CefrLevel,
  ProgressDay,
  ReviewRating,
  StoryResponse,
  VocabularyRecord,
  WorldDraft,
  WorldRecord,
} from "./types";

interface ParsedNote {
  frontmatter: Record<string, unknown>;
  body: string;
}

function splitNote(content: string): ParsedNote {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  try {
    return { frontmatter: (parseYaml(match[1] ?? "") || {}) as Record<string, unknown>, body: match[2] ?? "" };
  } catch {
    throw new Error("Snowpath 笔记的 frontmatter 无法解析");
  }
}

function composeNote(frontmatter: Record<string, unknown>, body: string): string {
  return `---\n${stringifyYaml(frontmatter)}---\n\n${body.trim()}\n`;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function section(body: string, title: string): string {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return body.match(new RegExp(`(?:^|\\n)## ${escaped}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`))?.[1]?.trim() ?? "";
}

function asNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function asCefr(value: unknown): CefrLevel {
  return ["A1", "A2", "B1", "B2", "C1", "C2"].includes(String(value)) ? String(value) as CefrLevel : "A1";
}

export class SnowpathStore {
  constructor(private readonly app: App, private readonly root: () => string) {}

  private path(...parts: string[]): string {
    return normalizePath([this.root(), ...parts].filter(Boolean).join("/"));
  }

  async initialize(): Promise<void> {
    await this.ensureFolder(this.root());
    await Promise.all(["Worlds", "Vocabulary", "Progress"].map((folder) => this.ensureFolder(this.path(folder))));
  }

  isOwnedPath(path: string): boolean {
    const root = normalizePath(this.root());
    const normalized = normalizePath(path);
    return normalized === root || normalized.startsWith(`${root}/`);
  }

  private async ensureFolder(path: string): Promise<void> {
    const segments = normalizePath(path).split("/");
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      if (!(await this.app.vault.adapter.exists(current))) await this.app.vault.createFolder(current);
    }
  }

  private file(path: string): TFile | null {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    return file instanceof TFile ? file : null;
  }

  private async read(path: string): Promise<ParsedNote | null> {
    const file = this.file(path);
    return file ? splitNote(await this.app.vault.cachedRead(file)) : null;
  }

  private async write(path: string, content: string): Promise<void> {
    const normalized = normalizePath(path);
    const file = this.file(normalized);
    if (file) await this.app.vault.modify(file, content);
    else await this.app.vault.create(normalized, content);
  }

  private worldPath(id: string): string {
    return this.path("Worlds", id, "world.md");
  }

  private worldNote(world: WorldRecord): string {
    return composeNote({
      snowpath_type: "world",
      snowpath_id: world.id,
      title: world.title,
      premise: world.premise,
      genre: world.genre,
      tone: world.tone,
      cefr: world.cefr,
      seed: world.seed ?? "",
      status: world.status,
      current_chapter: world.currentChapter,
      summary: world.summary,
      characters: world.characters,
      open_threads: world.openThreads,
      decisions: world.decisions,
      created_at: world.createdAt,
      updated_at: world.updatedAt,
    }, `# ${world.title}\n\n${world.premise}\n\n## Story summary\n\n${world.summary || "故事尚未开始。"}`);
  }

  async createWorld(draft: WorldDraft): Promise<WorldRecord> {
    await this.initialize();
    const now = new Date().toISOString();
    const world: WorldRecord = {
      ...draft,
      id: randomUUID(),
      status: "active",
      currentChapter: 0,
      summary: "",
      characters: [],
      openThreads: [],
      decisions: [],
      createdAt: now,
      updatedAt: now,
    };
    await this.ensureFolder(this.path("Worlds", world.id));
    await this.ensureFolder(this.path("Worlds", world.id, "chapters"));
    await this.write(this.worldPath(world.id), this.worldNote(world));
    return world;
  }

  private parseWorld(note: ParsedNote): WorldRecord {
    const fm = note.frontmatter;
    return {
      id: String(fm.snowpath_id ?? ""),
      title: String(fm.title ?? "未命名世界"),
      premise: String(fm.premise ?? ""),
      genre: String(fm.genre ?? "adventure"),
      tone: String(fm.tone ?? "hopeful"),
      cefr: asCefr(fm.cefr),
      seed: String(fm.seed ?? ""),
      status: fm.status === "completed" || fm.status === "archived" ? fm.status : "active",
      currentChapter: asNumber(fm.current_chapter),
      summary: String(fm.summary ?? ""),
      characters: stringArray(fm.characters),
      openThreads: stringArray(fm.open_threads),
      decisions: stringArray(fm.decisions),
      createdAt: String(fm.created_at ?? ""),
      updatedAt: String(fm.updated_at ?? ""),
    };
  }

  async listWorlds(): Promise<WorldRecord[]> {
    await this.initialize();
    const listed = await this.app.vault.adapter.list(this.path("Worlds"));
    const worlds: WorldRecord[] = [];
    for (const folder of listed.folders) {
      const note = await this.read(`${folder}/world.md`);
      if (note) worlds.push(this.parseWorld(note));
    }
    return worlds.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async loadWorld(id: string, reconcile = true): Promise<WorldRecord | null> {
    const note = await this.read(this.worldPath(id));
    if (!note) return null;
    const world = this.parseWorld(note);
    if (!reconcile) return world;
    const chapters = await this.listChapters(id);
    const repaired = reconcileWorldFromChapters(world, chapters);
    if (repaired !== world) await this.updateWorld(repaired);
    return repaired;
  }

  async updateWorld(world: WorldRecord): Promise<void> {
    await this.write(this.worldPath(world.id), this.worldNote(world));
  }

  private chapterPath(worldId: string, chapter: number): string {
    return this.path("Worlds", worldId, "chapters", `${String(chapter).padStart(4, "0")}.md`);
  }

  private chapterNote(chapter: ChapterRecord): string {
    return composeNote({
      snowpath_type: "chapter",
      snowpath_id: `${chapter.worldId}:${chapter.chapter}`,
      world_id: chapter.worldId,
      chapter: chapter.chapter,
      title: chapter.title,
      selected_action: chapter.selectedAction,
      vocabulary: chapter.vocabulary,
      choices: chapter.choices,
      story_state: chapter.state,
      created_at: chapter.createdAt,
      updated_at: chapter.createdAt,
    }, `# Chapter ${chapter.chapter} · ${chapter.title}\n\n## Story\n\n${chapter.paragraphs.join("\n\n")}\n\n## Translation\n\n${chapter.translation.join("\n\n")}\n\n## Learner action\n\n${chapter.selectedAction}`);
  }

  private parseChapter(note: ParsedNote): ChapterRecord {
    const fm = note.frontmatter;
    const rawChoices = Array.isArray(fm.choices) ? fm.choices : [];
    const rawWords = Array.isArray(fm.vocabulary) ? fm.vocabulary : [];
    const rawState = fm.story_state && typeof fm.story_state === "object" ? fm.story_state as Record<string, unknown> : {};
    return {
      worldId: String(fm.world_id ?? ""),
      chapter: asNumber(fm.chapter),
      title: String(fm.title ?? "Untitled chapter"),
      selectedAction: String(fm.selected_action ?? ""),
      createdAt: String(fm.created_at ?? ""),
      paragraphs: section(note.body, "Story").split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean),
      translation: section(note.body, "Translation").split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean),
      choices: rawChoices.map((choice, index) => {
        const value = choice as Record<string, unknown>;
        const difficulty = value.difficulty === "easier" || value.difficulty === "harder" ? value.difficulty : "steady";
        return { id: String(value.id ?? String.fromCharCode(65 + index)), text: String(value.text ?? ""), difficulty };
      }),
      vocabulary: rawWords.map((word) => {
        const value = word as Record<string, unknown>;
        return {
          word: String(value.word ?? ""), meaningZh: String(value.meaningZh ?? ""), definitionEn: String(value.definitionEn ?? ""),
          partOfSpeech: String(value.partOfSpeech ?? "word"), cefr: asCefr(value.cefr), sentence: String(value.sentence ?? ""),
        };
      }),
      state: {
        summary: String(rawState.summary ?? ""),
        characters: stringArray(rawState.characters),
        openThreads: stringArray(rawState.openThreads),
        decisions: stringArray(rawState.decisions),
      },
    };
  }

  async listChapters(worldId: string): Promise<ChapterRecord[]> {
    const folder = this.path("Worlds", worldId, "chapters");
    if (!(await this.app.vault.adapter.exists(folder))) return [];
    const listed = await this.app.vault.adapter.list(folder);
    const chapters: ChapterRecord[] = [];
    for (const path of listed.files.filter((file) => file.endsWith(".md")).sort()) {
      const note = await this.read(path);
      if (note) chapters.push(this.parseChapter(note));
    }
    return chapters.sort((a, b) => a.chapter - b.chapter);
  }

  async saveChapter(world: WorldRecord, response: StoryResponse, selectedAction: string, readingSeconds = 0): Promise<ChapterRecord> {
    const chapter: ChapterRecord = {
      ...response,
      worldId: world.id,
      chapter: world.currentChapter + 1,
      selectedAction,
      createdAt: new Date().toISOString(),
    };
    await this.write(this.chapterPath(world.id, chapter.chapter), this.chapterNote(chapter));
    for (const word of response.vocabulary) await this.upsertVocabulary(word, `${world.id}/${chapter.chapter}`);
    world.currentChapter = chapter.chapter;
    world.summary = response.state.summary;
    world.characters = response.state.characters;
    world.openThreads = response.state.openThreads;
    world.decisions = response.state.decisions;
    world.updatedAt = chapter.createdAt;
    await this.updateWorld(world);
    await this.updateProgress({ chapters: 1, wordsEncountered: response.vocabulary.length, readingSeconds });
    return chapter;
  }

  private vocabularyPath(word: string): string {
    return this.path("Vocabulary", wordFileName(word));
  }

  private vocabularyNote(word: VocabularyRecord): string {
    return composeNote({
      snowpath_type: "vocabulary",
      snowpath_id: word.id,
      word: word.word,
      meaning_zh: word.meaningZh,
      definition_en: word.definitionEn,
      part_of_speech: word.partOfSpeech,
      cefr: word.cefr,
      status: word.mastery,
      encounter_count: word.encounterCount,
      encounters: word.encounters,
      repetitions: word.review.repetitions,
      interval_days: word.review.intervalDays,
      ease: word.review.ease,
      lapses: word.review.lapses,
      due_at: word.review.dueAt,
      created_at: word.createdAt,
      updated_at: word.updatedAt,
    }, `# ${word.word}\n\n${word.meaningZh || "待补充中文释义"}\n\n## English definition\n\n${word.definitionEn || "To be completed during the next encounter."}\n\n## Example\n\n${word.sentence || ""}`);
  }

  private parseVocabulary(note: ParsedNote): VocabularyRecord {
    const fm = note.frontmatter;
    const status = String(fm.status);
    return {
      id: String(fm.snowpath_id ?? fm.word ?? ""),
      word: normalizeWord(String(fm.word ?? "")),
      meaningZh: String(fm.meaning_zh ?? ""),
      definitionEn: String(fm.definition_en ?? ""),
      partOfSpeech: String(fm.part_of_speech ?? "word"),
      cefr: asCefr(fm.cefr),
      sentence: section(note.body, "Example"),
      mastery: status === "learning" || status === "familiar" || status === "mastered" ? status : "new",
      encounterCount: asNumber(fm.encounter_count),
      encounters: stringArray(fm.encounters),
      review: {
        repetitions: asNumber(fm.repetitions),
        intervalDays: asNumber(fm.interval_days),
        ease: asNumber(fm.ease, 2.5),
        lapses: asNumber(fm.lapses),
        dueAt: String(fm.due_at ?? new Date().toISOString()),
      },
      createdAt: String(fm.created_at ?? ""),
      updatedAt: String(fm.updated_at ?? ""),
    };
  }

  async upsertVocabulary(word: StoryResponse["vocabulary"][number], encounter: string): Promise<VocabularyRecord> {
    const normalized = normalizeWord(word.word);
    const path = this.vocabularyPath(normalized);
    const existingNote = await this.read(path);
    const now = new Date().toISOString();
    const existing = existingNote ? this.parseVocabulary(existingNote) : null;
    const newEncounter = Boolean(encounter) && !existing?.encounters.includes(encounter);
    const record: VocabularyRecord = existing ? {
      ...existing,
      meaningZh: word.meaningZh || existing.meaningZh,
      definitionEn: word.definitionEn || existing.definitionEn,
      partOfSpeech: word.partOfSpeech || existing.partOfSpeech,
      cefr: word.cefr || existing.cefr,
      sentence: word.sentence || existing.sentence,
      encounterCount: newEncounter ? existing.encounterCount + 1 : existing.encounterCount,
      encounters: newEncounter ? [...existing.encounters, encounter] : existing.encounters,
      updatedAt: now,
    } : {
      ...word,
      id: normalized,
      word: normalized,
      mastery: "new",
      encounterCount: encounter ? 1 : 0,
      encounters: encounter ? [encounter] : [],
      review: { repetitions: 0, intervalDays: 0, ease: 2.5, lapses: 0, dueAt: now },
      createdAt: now,
      updatedAt: now,
    };
    await this.write(path, this.vocabularyNote(record));
    return record;
  }

  async importVocabulary(items: Array<{ word: string; meaningZh: string }>, level: CefrLevel): Promise<number> {
    let count = 0;
    for (const item of items) {
      const path = this.vocabularyPath(item.word);
      const existingNote = await this.read(path);
      if (existingNote) {
        const existing = this.parseVocabulary(existingNote);
        if (!existing.meaningZh && item.meaningZh) {
          existing.meaningZh = item.meaningZh;
          await this.saveVocabulary(existing);
        }
        continue;
      }
      await this.upsertVocabulary({
        word: item.word,
        meaningZh: item.meaningZh,
        definitionEn: "",
        partOfSpeech: "word",
        cefr: level,
        sentence: "",
      }, "");
      count += 1;
    }
    return count;
  }

  async listVocabulary(): Promise<VocabularyRecord[]> {
    await this.initialize();
    const listed = await this.app.vault.adapter.list(this.path("Vocabulary"));
    const words: VocabularyRecord[] = [];
    for (const path of listed.files.filter((file) => file.endsWith(".md"))) {
      const note = await this.read(path);
      if (note) words.push(this.parseVocabulary(note));
    }
    return words.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.word.localeCompare(b.word));
  }

  async saveVocabulary(word: VocabularyRecord): Promise<void> {
    word.updatedAt = new Date().toISOString();
    word.mastery = masteryForReview(word.review);
    await this.write(this.vocabularyPath(word.word), this.vocabularyNote(word));
  }

  async recordReview(word: VocabularyRecord, rating: ReviewRating): Promise<void> {
    await this.saveVocabulary(word);
    await this.updateProgress({ reviews: 1, reviewSuccess: rating === "again" ? 0 : 1 });
  }

  private progressPath(date: string): string {
    return this.path("Progress", `${date}.md`);
  }

  private async updateProgress(delta: Partial<Omit<ProgressDay, "date">>): Promise<void> {
    const date = localDateKey();
    const note = await this.read(this.progressPath(date));
    const fm = note?.frontmatter ?? {};
    const progress: ProgressDay = {
      date,
      readingSeconds: asNumber(fm.reading_seconds) + (delta.readingSeconds ?? 0),
      chapters: asNumber(fm.chapters) + (delta.chapters ?? 0),
      wordsEncountered: asNumber(fm.words_encountered) + (delta.wordsEncountered ?? 0),
      reviews: asNumber(fm.reviews) + (delta.reviews ?? 0),
      reviewSuccess: asNumber(fm.review_success) + (delta.reviewSuccess ?? 0),
    };
    await this.write(this.progressPath(date), composeNote({
      snowpath_type: "progress",
      snowpath_id: date,
      date,
      reading_seconds: progress.readingSeconds,
      chapters: progress.chapters,
      words_encountered: progress.wordsEncountered,
      reviews: progress.reviews,
      review_success: progress.reviewSuccess,
      updated_at: new Date().toISOString(),
    }, `# Snowpath · ${date}\n\n- 阅读时长：${Math.round(progress.readingSeconds / 60)} 分钟\n- 完成章节：${progress.chapters}\n- 遇见词汇：${progress.wordsEncountered}\n- 复习次数：${progress.reviews}`));
  }

  async listProgress(days: number): Promise<ProgressDay[]> {
    await this.initialize();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - Math.max(1, days) + 1);
    const cutoffDate = localDateKey(cutoff);
    const listed = await this.app.vault.adapter.list(this.path("Progress"));
    const result: ProgressDay[] = [];
    for (const path of listed.files.filter((file) => file.endsWith(".md") && file.slice(-13, -3) >= cutoffDate)) {
      const note = await this.read(path);
      if (!note) continue;
      const fm = note.frontmatter;
      result.push({
        date: String(fm.date ?? path.slice(-13, -3)),
        readingSeconds: asNumber(fm.reading_seconds),
        chapters: asNumber(fm.chapters),
        wordsEncountered: asNumber(fm.words_encountered),
        reviews: asNumber(fm.reviews),
        reviewSuccess: asNumber(fm.review_success),
      });
    }
    return result.sort((a, b) => a.date.localeCompare(b.date));
  }
}
