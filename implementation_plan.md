# Google News CLI Tool

A Node.js command-line application to fetch, search, and display the latest news from Google News.

## Chosen Interaction Model
We will implement an **Interactive CLI** where the user can:
1. View a list of headlines in the terminal.
2. Scroll through them using arrow keys.
3. Select an article and press Enter to open it in their default web browser.
4. Exit the menu using Esc or Ctrl+C.

### Dependencies
- `rss-parser`: To fetch and parse Google News XML RSS feeds into JSON.
- `commander`: To handle command-line options and arguments.
- `picocolors`: A lightweight terminal text coloring package.
- `prompts`: To build the interactive scrollable selection list in the terminal.
- `open`: To open the selected news article in the default browser.

## Proposed Changes

### Project Structure
```
c:\Users\manas\Desktop\SDE\Antigravity_projects\
├── package.json
├── index.js
├── README.md
```

#### [NEW] [package.json](file:///c:/Users/manas/Desktop/SDE/Antigravity_projects/package.json)
Initializes the Node project with `"type": "module"` and lists our dependencies.

#### [NEW] [index.js](file:///c:/Users/manas/Desktop/SDE/Antigravity_projects/index.js)
The main executable entry point that:
1. Parses flags like `--search`, `--limit`, `--topic`, `--lang`.
2. Fetches the appropriate Google News RSS feed.
3. Displays the news list interactively using `prompts`.
4. Opens the selected article using `open`.

#### [NEW] [README.md](file:///c:/Users/manas/Desktop/SDE/Antigravity_projects/README.md)
Contains installation and usage guidelines.


## Verification Plan

### Manual Verification
- Run the tool using `node index.js` and verify it displays the latest top news.
- Run `node index.js --search "artificial intelligence"` and verify it returns matching results.
- Run `node index.js --limit 5` to verify the limit option works.
- Test running it as a globally linked command if desired.
