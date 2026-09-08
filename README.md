# Snowpath（雪径）

Snowpath 是一个桌面端 Obsidian 插件：根据 CEFR 难度生成可选择、可续写的英文故事，并把章节、生词与学习进度保存在 Markdown 中。

灵感来自 [I+1 Quest](https://snowball-diary.github.io/iplus1-quest/)。本项目为独立实现，不包含原项目代码、Logo 或图片。

## 在 Obsidian 中安装

Snowpath 目前仅支持 macOS / Windows 桌面版 Obsidian。

### 方式一：使用 BRAT（推荐）

1. 在 Obsidian 的「设置 → 第三方插件 → 浏览」中安装并启用 **BRAT**。
2. 打开命令面板，运行 `BRAT: Add a beta plugin for testing`。
3. 输入仓库地址：

   ```text
   https://github.com/zx490336534/obsidian-snowpath
   ```

4. 选择最新版本并完成安装。
5. 回到「设置 → 第三方插件」，启用 **Snowpath**。

BRAT 会从最新 GitHub Release 读取 `manifest.json`、`main.js` 和 `styles.css`。当前仓库为私有仓库，安装账号必须拥有访问权限，并在 BRAT 中配置仅授予本仓库 `Contents: Read-only` 权限的 GitHub fine-grained token。详见 [BRAT 开发者指南](https://github.com/TfTHacker/obsidian42-brat/blob/main/BRAT-DEVELOPER-GUIDE.md#access-to-private-repositories)。

### 方式二：手动拷贝

1. 从 [Releases](https://github.com/zx490336534/obsidian-snowpath/releases) 下载最新版 `snowpath.zip` 并解压。
2. 在你的 vault 中创建插件目录：

   ```text
   <你的 Vault>/.obsidian/plugins/snowpath/
   ```

3. 将下面三个文件复制到该目录：

   ```text
   main.js
   manifest.json
   styles.css
   ```

4. 重启 Obsidian，或在「设置 → 第三方插件」中重新加载插件。
5. 启用 **Snowpath**。

macOS 也可以在解压目录运行：

```bash
mkdir -p "/你的/Vault/.obsidian/plugins/snowpath"
cp main.js manifest.json styles.css "/你的/Vault/.obsidian/plugins/snowpath/"
```

Windows PowerShell：

```powershell
$dest = "C:\你的\Vault\.obsidian\plugins\snowpath"
New-Item -ItemType Directory -Force $dest
Copy-Item main.js, manifest.json, styles.css $dest
```

## 开始使用

1. 打开「设置 → Snowpath」，选择 Codex CLI、Claude CLI 或 OpenAI-compatible API。
2. 打开命令面板，运行 `Snowpath: 打开 Snowpath`。
3. 首次使用可完成英语水平评估，也可以直接选择 A1–C2 难度。
4. 在「冒险 → 新建世界」中组合故事方向，预览大纲后创建世界。
5. 阅读时可以逐句或全文朗读、查看翻译、积累生词，并在「复习」中完成闪卡练习。

学习数据默认保存在 vault 的 `2-领域/学习/英语/Snowpath/`，可在 Snowpath 设置中修改。卸载插件不会自动删除这些 Markdown 学习记录。

## 本地开发

```bash
npm install
npm test
npm run install:local
obsidian vault=myNote plugin:reload id=snowpath
```
