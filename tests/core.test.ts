import { test } from "node:test";
import { strict as assert } from "node:assert";
import {
  buildStoryPrompt,
  createRandomWorldPreview,
  aggregateProgress,
  computeQuizLevel,
  extractCodexMessage,
  extractJsonObject,
  masteryForReview,
  localDateKey,
  normalizeWord,
  parseWordList,
  preferredEnglishVoices,
  reconcileWorldFromChapters,
  scheduleReview,
  scoreAssessment,
  trimStoryContext,
  validateStoryDifficulty,
  validateStoryResponse,
  withTimeout,
  wordFileName,
  type StoryContext,
} from "../src/core";
import type { AssessmentAnswer } from "../src/types";

test("normalizes and deduplicates imported Markdown/CSV words", () => {
  const parsed = parseWordList("word, meaning\n- [ ] Resilient, 有韧性\n| subtle | 微妙的 |\nresilient, duplicate\n# heading");
  assert.deepEqual(parsed, [
    { word: "resilient", meaningZh: "有韧性" },
    { word: "subtle", meaningZh: "微妙的" },
  ]);
  assert.equal(normalizeWord("  ‘Curious!’ "), "curious");
  assert.match(wordFileName("Curious"), /^curious-[a-z0-9]+\.md$/);
});

test("keeps only the best few English reading voices", () => {
  const voices = preferredEnglishVoices([
    { name: "婷婷", lang: "zh-CN" },
    { name: "Bad News", lang: "en-US" },
    { name: "Karen", lang: "en-AU" },
    { name: "Daniel", lang: "en-GB" },
    { name: "Moira", lang: "en-IE" },
    { name: "Samantha", lang: "en-US" },
    { name: "Rishi", lang: "en-IN" },
  ]);
  assert.deepEqual(voices.map((voice) => voice.name), ["Samantha", "Daniel", "Karen", "Moira"]);
});

test("scores adaptive questions and combines assessment weights", () => {
  const answers: AssessmentAnswer[] = [
    { item: { id: "1", level: "B1", prompt: "", options: [], answer: 0 }, correct: true },
    { item: { id: "2", level: "B2", prompt: "", options: [], answer: 0 }, correct: true },
    { item: { id: "3", level: "C1", prompt: "", options: [], answer: 0 }, correct: false },
  ];
  assert.equal(computeQuizLevel(answers), "B2");
  assert.equal(scoreAssessment("B1", "B2", "B2", new Date("2026-09-08T00:00:00Z")).level, "B2");
  assert.equal(scoreAssessment("A2", "B1", undefined, new Date("2026-09-08T00:00:00Z")).level, "B1");
});

test("schedules reviews without losing lapse history", () => {
  const initial = { repetitions: 0, intervalDays: 0, ease: 2.5, lapses: 0, dueAt: "2026-09-08T00:00:00Z" };
  const good = scheduleReview(initial, "good", new Date("2026-09-08T00:00:00Z"));
  assert.equal(good.repetitions, 1);
  assert.equal(good.intervalDays, 1);
  assert.equal(masteryForReview(good), "learning");
  const lapsed = scheduleReview(good, "again", new Date("2026-09-09T00:00:00Z"));
  assert.equal(lapsed.repetitions, 0);
  assert.equal(lapsed.lapses, 1);
  assert.equal(lapsed.intervalDays, 1);
});

test("extracts fenced JSON and validates a complete chapter", () => {
  const raw = {
    title: "The Letter",
    paragraphs: ["Mira opens the letter."],
    translation: ["米拉打开了信。"],
    vocabulary: [{ word: "letter", meaningZh: "信", definitionEn: "a written message", partOfSpeech: "noun", cefr: "A1", sentence: "Mira opens the letter." }],
    choices: [
      { id: "A", text: "Read it.", difficulty: "easier" },
      { id: "B", text: "Hide it.", difficulty: "steady" },
      { id: "C", text: "Find its sender.", difficulty: "harder" },
    ],
    state: { summary: "Mira receives a letter.", characters: ["Mira"], openThreads: ["Who sent it?"], decisions: [] },
  };
  assert.equal(validateStoryResponse(extractJsonObject(`\`\`\`json\n${JSON.stringify(raw)}\n\`\`\``)).title, "The Letter");
  assert.throws(() => validateStoryResponse({ ...raw, choices: raw.choices.slice(0, 2) }), /三个选择/);
});

test("takes only the final assistant message from Codex JSONL", () => {
  const output = [
    JSON.stringify({ type: "thread.started", thread_id: "test" }),
    "stray diagnostic",
    JSON.stringify({ type: "item.completed", item: { type: "error", message: "warning" } }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: '{"title":"chapter"}' } }),
    JSON.stringify({ type: "turn.completed" }),
  ].join("\n");
  assert.equal(extractCodexMessage(output), '{"title":"chapter"}');
  assert.throws(() => extractCodexMessage('{}\nnot json'), /最终消息/);
});

test("trims long campaign context before generating the prompt", () => {
  const context: StoryContext = {
    world: {
      id: "world", title: "Test", premise: "Premise", genre: "mystery", tone: "quiet", cefr: "B1", status: "active",
      currentChapter: 8, summary: "s".repeat(4000), characters: Array.from({ length: 30 }, (_, i) => `c${i}`),
      openThreads: Array.from({ length: 20 }, (_, i) => `t${i}`), decisions: Array.from({ length: 40 }, (_, i) => `d${i}`),
      createdAt: "", updatedAt: "",
    },
    recentChapters: Array.from({ length: 7 }, (_, i) => ({ chapter: i + 1, story: "x".repeat(5000), selectedAction: "go" })),
    targetWords: Array.from({ length: 20 }, (_, i) => `word${i}`),
    action: "a".repeat(2000),
    wordsPerChapter: 6,
  };
  const trimmed = trimStoryContext(context);
  assert.equal(trimmed.recentChapters.length, 3);
  assert.equal(trimmed.targetWords.length, 6);
  assert.equal(trimmed.world.openThreads.length, 12);
  assert.equal(trimmed.action.length, 1000);
  assert.ok(buildStoryPrompt(context).includes("CEFR B1"));
});

test("gives A2 stories hard readability limits", () => {
  const context: StoryContext = {
    world: {
      id: "world", title: "Test", premise: "Premise", genre: "mystery", tone: "quiet", cefr: "A2", status: "active",
      currentChapter: 0, summary: "", characters: [], openThreads: [], decisions: [], createdAt: "", updatedAt: "",
    },
    recentChapters: [], targetWords: [], action: "begin", wordsPerChapter: 6,
  };
  const prompt = buildStoryPrompt(context);
  assert.match(prompt, /100-160 English words/);
  assert.match(prompt, /14 English words/);
  assert.doesNotMatch(prompt, /220-360 English words/);

  const base = validateStoryResponse({
    title: "Simple morning",
    paragraphs: ["Mira opens the shop. A new customer walks in."],
    translation: ["米拉打开商店。一位新顾客走了进来。"],
    vocabulary: [{ word: "customer", meaningZh: "顾客", definitionEn: "a person who buys something", partOfSpeech: "noun", cefr: "A2", sentence: "A new customer walks in." }],
    choices: [
      { id: "A", text: "Say hello.", difficulty: "easier" },
      { id: "B", text: "Ask a question.", difficulty: "steady" },
      { id: "C", text: "Wait by the door.", difficulty: "harder" },
    ],
    state: { summary: "Mira opens the shop.", characters: ["Mira"], openThreads: [], decisions: [] },
  });
  assert.equal(validateStoryDifficulty(base, "A2", 6).title, "Simple morning");
  assert.throws(() => validateStoryDifficulty({ ...base, paragraphs: [Array.from({ length: 161 }, () => "word").join(" ") + "."] }, "A2", 6), /最多 160/);
});

test("keeps A1 chapters short, concrete, and story-forward", () => {
  const context: StoryContext = {
    world: {
      id: "world", title: "Test", premise: "Premise", genre: "mystery", tone: "tense", cefr: "A1", status: "active",
      currentChapter: 0, summary: "", characters: [], openThreads: [], decisions: [], createdAt: "", updatedAt: "",
    },
    recentChapters: [], targetWords: [], action: "begin", wordsPerChapter: 6,
  };
  const prompt = buildStoryPrompt(context);
  assert.match(prompt, /45-70 English words/);
  assert.match(prompt, /7 English words/);
  assert.match(prompt, /first two sentences/);
  assert.match(prompt, /change the situation/);

  const story = validateStoryResponse({
    title: "The red door",
    paragraphs: [Array.from({ length: 10 }, () => "Mia walks to the small red door.").join(" ") + " Stop."],
    translation: ["米娅走向那扇红色的小门。停下。"],
    vocabulary: [],
    choices: [
      { id: "A", text: "Open it.", difficulty: "easier" },
      { id: "B", text: "Call Ben.", difficulty: "steady" },
      { id: "C", text: "Run away.", difficulty: "harder" },
    ],
    state: { summary: "Mia finds a red door.", characters: ["Mia"], openThreads: [], decisions: [] },
  });
  assert.throws(() => validateStoryDifficulty(story, "A1", 6), /最多 70/);
});

test("story seeds change the AI prompt", () => {
  const context: StoryContext = {
    world: {
      id: "world", title: "Test", premise: "Premise", genre: "mystery", tone: "quiet", cefr: "A2", status: "active",
      currentChapter: 0, summary: "", characters: [], openThreads: [], decisions: [], seed: "snow-a", createdAt: "", updatedAt: "",
    },
    recentChapters: [], targetWords: [], action: "begin", wordsPerChapter: 4,
  };
  const first = buildStoryPrompt(context);
  const second = buildStoryPrompt({ ...context, world: { ...context.world, seed: "snow-b" } });
  assert.notEqual(first, second);
});

test("builds reproducible mixed worlds with broad variation", () => {
  const mix = { directions: ["detective", "cultivation", "daily", "mythology", "food", "mecha"], protagonist: "cultivator", setting: "ancient-east", drive: "growth", audience: "female", mood: "suspense" };
  const first = createRandomWorldPreview(mix, "snow-001", "A2");
  assert.deepEqual(first, createRandomWorldPreview(mix, "snow-001", "A2"));
  assert.match(first.draft.genre, /detective mystery.*Chinese cultivation fantasy.*warm slice of life.*East Asian mythology.*food and culinary story/);
  assert.doesNotMatch(first.draft.genre, /mecha/);
  assert.match(first.draft.premise, /novice cultivator.*ancient East Asian realm|ancient East Asian realm.*novice cultivator/);
  assert.match(first.draft.tone, /female lead/);
  assert.match(first.outlineZh, /侦探 × 修仙 × 日常 × 神话 × 美食/);
  assert.match(first.outlineZh, /修行新人.*东方古代.*成长升级/);
  assert.match(first.outlineZh, /开场：.*\n主线：.*\n阻力：.*\n转折：.*\n第一阶段目标：/);
  const worlds = new Set(Array.from({ length: 64 }, (_, index) => {
    const world = createRandomWorldPreview(mix, `snow-${index}`, "A2").draft;
    return `${world.title}|${world.premise}`;
  }));
  assert.ok(worlds.size >= 56, `expected broad variation, got ${worlds.size}`);
});

test("aggregates progress and counts an unbroken learning streak", () => {
  const today = new Date();
  const date = (offset: number) => {
    const value = new Date(today);
    value.setDate(value.getDate() - offset);
    return localDateKey(value);
  };
  const result = aggregateProgress([
    { date: date(0), readingSeconds: 120, chapters: 1, wordsEncountered: 4, reviews: 3, reviewSuccess: 2 },
    { date: date(1), readingSeconds: 60, chapters: 0, wordsEncountered: 0, reviews: 2, reviewSuccess: 2 },
  ]);
  assert.deepEqual(result, { readingSeconds: 180, chapters: 1, wordsEncountered: 4, reviews: 5, reviewSuccess: 4, streak: 2 });
});

test("uses the learner's local calendar date for daily progress", () => {
  assert.equal(localDateKey(new Date(2026, 8, 8, 0, 5)), "2026-09-08");
});

test("rebuilds stale world state from the latest chapter", () => {
  const world: StoryContext["world"] = {
    id: "world", title: "Test", premise: "Premise", genre: "mystery", tone: "quiet", cefr: "B1", status: "active",
    currentChapter: 1, summary: "stale", characters: [], openThreads: [], decisions: [], createdAt: "old", updatedAt: "old",
  };
  const repaired = reconcileWorldFromChapters(world, [{
    worldId: "world", chapter: 2, title: "Two", paragraphs: ["Story"], translation: ["故事"], vocabulary: [], choices: [],
    selectedAction: "Go", state: { summary: "current", characters: ["Mira"], openThreads: ["Gate"], decisions: ["Go"] }, createdAt: "new",
  }]);
  assert.equal(repaired.currentChapter, 2);
  assert.equal(repaired.summary, "current");
  assert.deepEqual(repaired.openThreads, ["Gate"]);
});

test("times out and cancels pending AI work without accepting late results", async () => {
  await assert.rejects(withTimeout(new Promise(() => undefined), 5), /请求超时/);
  const controller = new AbortController();
  const pending = withTimeout(new Promise(() => undefined), 1000, controller.signal);
  controller.abort();
  await assert.rejects(pending, /已取消生成/);
});
