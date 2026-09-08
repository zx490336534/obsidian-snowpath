export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type CefrLevel = typeof CEFR_LEVELS[number];
export type Mastery = "new" | "learning" | "familiar" | "mastered";
export type ProviderId = "codex-cli" | "claude-cli" | "openai-compatible";
export type Route = "adventure" | "assessment" | "vocabulary" | "review" | "history" | "stats";
export type ReviewRating = "again" | "hard" | "good" | "easy";

export interface SnowpathSettings {
  dataRoot: string;
  provider: ProviderId;
  apiBaseUrl: string;
  apiModel: string;
  apiKeyCipher: string;
  cliPath: string;
  cliModel: string;
  ttsVoice: string;
  ttsRate: number;
  wordsPerChapter: number;
  lastWorldId: string;
  assessment?: AssessmentResult;
}

export const DEFAULT_SETTINGS: SnowpathSettings = {
  dataRoot: "2-领域/学习/英语/Snowpath",
  provider: "codex-cli",
  apiBaseUrl: "https://api.openai.com/v1",
  apiModel: "gpt-4.1-mini",
  apiKeyCipher: "",
  cliPath: "",
  cliModel: "",
  ttsVoice: "",
  ttsRate: 0.9,
  wordsPerChapter: 6,
  lastWorldId: "",
};

export interface WorldDraft {
  title: string;
  premise: string;
  genre: string;
  tone: string;
  cefr: CefrLevel;
  seed?: string;
}

export interface WorldRecord extends WorldDraft {
  id: string;
  status: "active" | "completed" | "archived";
  currentChapter: number;
  summary: string;
  characters: string[];
  openThreads: string[];
  decisions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface StoryVocabulary {
  word: string;
  meaningZh: string;
  definitionEn: string;
  partOfSpeech: string;
  cefr: CefrLevel;
  sentence: string;
}

export interface StoryChoice {
  id: string;
  text: string;
  difficulty: "easier" | "steady" | "harder";
}

export interface StoryResponse {
  title: string;
  paragraphs: string[];
  translation: string[];
  vocabulary: StoryVocabulary[];
  choices: StoryChoice[];
  state: {
    summary: string;
    characters: string[];
    openThreads: string[];
    decisions: string[];
  };
}

export interface ChapterRecord extends StoryResponse {
  worldId: string;
  chapter: number;
  selectedAction: string;
  createdAt: string;
}

export interface ReviewState {
  repetitions: number;
  intervalDays: number;
  ease: number;
  lapses: number;
  dueAt: string;
}

export interface VocabularyRecord extends StoryVocabulary {
  id: string;
  mastery: Mastery;
  encounterCount: number;
  encounters: string[];
  review: ReviewState;
  createdAt: string;
  updatedAt: string;
}

export interface ProgressDay {
  date: string;
  readingSeconds: number;
  chapters: number;
  wordsEncountered: number;
  reviews: number;
  reviewSuccess: number;
}

export interface AssessmentResult {
  level: CefrLevel;
  selfLevel: CefrLevel;
  quizLevel: CefrLevel;
  dialogueLevel?: CefrLevel;
  updatedAt: string;
}

export interface AssessmentItem {
  id: string;
  level: CefrLevel;
  prompt: string;
  options: string[];
  answer: number;
}

export interface AssessmentAnswer {
  item: AssessmentItem;
  correct: boolean;
}

export const ASSESSMENT_ITEMS: AssessmentItem[] = [
  { id: "a1-1", level: "A1", prompt: "I ___ from China.", options: ["am", "is", "are", "be"], answer: 0 },
  { id: "a1-2", level: "A1", prompt: "Choose the opposite of ‘big’.", options: ["long", "small", "slow", "old"], answer: 1 },
  { id: "a1-3", level: "A1", prompt: "She has two ___.", options: ["cat", "cats", "cates", "cat's"], answer: 1 },
  { id: "a1-4", level: "A1", prompt: "What time ___ you get up?", options: ["do", "does", "are", "is"], answer: 0 },
  { id: "a2-1", level: "A2", prompt: "I have lived here ___ 2020.", options: ["for", "since", "from", "at"], answer: 1 },
  { id: "a2-2", level: "A2", prompt: "If it rains, we ___ at home.", options: ["stay", "stayed", "will stay", "staying"], answer: 2 },
  { id: "a2-3", level: "A2", prompt: "This book is ___ than that one.", options: ["interesting", "more interesting", "most interesting", "interest"], answer: 1 },
  { id: "a2-4", level: "A2", prompt: "He asked me ___ the window.", options: ["open", "opened", "to open", "opening"], answer: 2 },
  { id: "b1-1", level: "B1", prompt: "By the time we arrived, the film ___.", options: ["started", "has started", "had started", "starts"], answer: 2 },
  { id: "b1-2", level: "B1", prompt: "I wish I ___ more free time.", options: ["have", "had", "will have", "am having"], answer: 1 },
  { id: "b1-3", level: "B1", prompt: "The meeting was ___ because the manager was ill.", options: ["put off", "put out", "put up", "put through"], answer: 0 },
  { id: "b1-4", level: "B1", prompt: "Choose the closest meaning of ‘reluctant’.", options: ["unwilling", "excited", "certain", "careless"], answer: 0 },
  { id: "b2-1", level: "B2", prompt: "Hardly ___ the door when the phone rang.", options: ["I closed", "had I closed", "I had closed", "did I close"], answer: 1 },
  { id: "b2-2", level: "B2", prompt: "Her explanation was plausible, ___ not entirely convincing.", options: ["despite", "although", "however", "whereas"], answer: 1 },
  { id: "b2-3", level: "B2", prompt: "The policy may have unintended ___.", options: ["consequences", "sequences", "circumstances", "incidents"], answer: 0 },
  { id: "b2-4", level: "B2", prompt: "‘The evidence is inconclusive’ means it ___.", options: ["proves the claim", "cannot support a firm conclusion", "is false", "was collected illegally"], answer: 1 },
  { id: "c1-1", level: "C1", prompt: "His apology did little to ___ concerns about the decision.", options: ["allay", "relay", "belay", "delay"], answer: 0 },
  { id: "c1-2", level: "C1", prompt: "Were the proposal ___, costs would fall substantially.", options: ["adopting", "adopted", "to adopt", "adopts"], answer: 1 },
  { id: "c1-3", level: "C1", prompt: "The article offers a ___ critique rather than a balanced analysis.", options: ["trenchant", "tentative", "tacit", "trivial"], answer: 0 },
  { id: "c1-4", level: "C1", prompt: "‘A Pyrrhic victory’ is a success that ___.", options: ["comes unexpectedly", "costs too much to be worthwhile", "ends a conflict", "depends on luck"], answer: 1 },
  { id: "c2-1", level: "C2", prompt: "The witness gave an ___ account, rich in detail yet hard to verify.", options: ["evanescent", "embroidered", "equivocal", "empirical"], answer: 1 },
  { id: "c2-2", level: "C2", prompt: "Choose the sentence with the most natural collocation.", options: ["mitigate a concern", "mitigate a decision", "mitigate an inference", "mitigate a permission"], answer: 0 },
  { id: "c2-3", level: "C2", prompt: "‘His argument is not so much wrong as beside the point’ primarily ___.", options: ["fully agrees", "rejects its relevance", "questions its grammar", "praises its originality"], answer: 1 },
  { id: "c2-4", level: "C2", prompt: "Her prose is lucid without being ___.", options: ["pellucid", "pedestrian", "perfunctory", "peripheral"], answer: 1 },
];
