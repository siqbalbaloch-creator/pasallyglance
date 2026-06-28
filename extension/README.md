# PasallyGlance

A context-aware AI assistant for your browser. Select or right-click anything on a page — text, an image, an email, a code block, a table, a link — and get an instant answer in place. Privacy-first and model-agnostic: you bring your own Anthropic API key, and the only thing that ever leaves your machine is the content you choose to ask about.

## Install (unpacked)

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top-right)
3. Click **Load unpacked** and select this folder
4. Click the PasallyGlance toolbar icon → **Options** and paste your Anthropic API key

## How it works

- **Select** any text and a small chip appears → tap it to pick an action (Explain, Summarize, Translate, Ask…).
- **Right-click** anything — text, image, link, or the page — and choose **"Ask AI about this."**
- Answers stream into a pinned panel where you can ask follow-ups, go deeper (Sonnet), copy, or insert (in Gmail).
- Nothing fires a network request until you tap an action. The chip is local-only.

## Privacy

- Your API key is stored locally in `chrome.storage` and is never sent anywhere except `api.anthropic.com`.
- Page content is only transmitted when you explicitly invoke an action, and only the relevant snippet is sent.
- No analytics, no tracking, no servers in between — calls go straight from your browser to Anthropic with your key.

## Settings

Quick model (default Haiku) and deep model (default Sonnet), selection-chip on/off, optional hover trigger, translation target language, and an optional daily request cap.

## Project layout

```
manifest.json              MV3 manifest, permissions, icon + toolbar action
icons/                     app icon (svg source + 16/32/48/128/512 png)
src/
  background.js            service worker: Anthropic streaming proxy + context menu
  options/                 settings page
  content/
    guard.js               decides when to stay silent (password fields, inputs, own UI)
    classify.js            element under cursor -> typed context + actions
    ui.js                  shadow-DOM chip + conversation panel
    dwell.js               selection / hover trigger state machine
    adapters/gmail.js      email context: reply, summarize, insert into compose
    main.js                wiring, prompts, models, usage cap, translation
```

## License

Personal project. Not affiliated with Anthropic.
