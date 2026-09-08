# Snowpath（雪径）

Snowpath 是一个桌面端 Obsidian 插件：根据 CEFR 难度生成可选择、可续写的英文故事，并把章节、生词与学习进度保存在 Markdown 中。

灵感来自 [I+1 Quest](https://snowball-diary.github.io/iplus1-quest/)。本项目为独立实现，不包含原项目代码、Logo 或图片。

## 本地开发

```bash
npm install
npm test
npm run install:local
obsidian vault=myNote plugin:reload id=snowpath
```

当前仅支持 macOS / Windows 桌面版 Obsidian。
