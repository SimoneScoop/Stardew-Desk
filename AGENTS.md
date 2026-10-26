# Repository Guidelines

## Project Structure & Module Organization

`scene/` is the shared browser-based farm: `index.html` and `main.js` render it, `setup.html` and `setup.js` read local game assets, and modules such as `weather.js` and `board.js` implement features. `scene/lib/` contains third-party parsers and licenses. `mac/` contains the JXA host and build scripts; `win/` contains the Electron host and Win32 integration. `docs/` holds screenshots and a demo. There is no test directory.

## Build, Test, and Development Commands

- `sh mac/debug.sh`: run the macOS host from the checkout after quitting the installed app; errors print to the terminal.
- `sh mac/install.sh`: build and install the macOS app in `~/Applications`, then launch it. `sh mac/package.sh` creates a shareable ZIP on the Desktop.
- `cd win && npm install && npm start`: install dependencies and run the Electron host locally.
- `cd win && npm run dist`: package the Windows ZIP under `win/dist/`.
- Open `scene/index.html` in a browser to inspect the scene. It needs locally extracted `scene/data/`; use query parameters such as `?t=18.5&w=rain&s=fall` to exercise states.

## Coding Style & Naming Conventions

Match surrounding JavaScript: two-space indentation, semicolons, single quotes, and `camelCase` names. Preserve classic scripts in `scene/` and JXA-compatible code in `mac/host.js`; avoid new runtime assumptions for shared code. Keep features in their corresponding scene module and update both hosts for shared host-facing behavior. No formatter or linter is configured.

## Testing Guidelines

There is no automated test script or coverage threshold. Check JavaScript syntax with `node --check` on changed compatible files, then manually exercise the affected scene states and host UI. For cross-platform features, verify macOS and Windows behavior where available; report any platform you could not run. Include reproduction steps and observed results in the PR.

## Commit & Pull Request Guidelines

Recent commits use short, imperative, descriptive subjects (for example, `Fix bird sprite direction, fence layering, and macOS scene resets (#2)`); no Conventional Commits scheme is in use. Keep commits focused. PRs should explain the behavior change, link a relevant issue, list validation and platform coverage, and attach screenshots or a short recording for visual changes.

## Assets & Privacy

Never commit `scene/data/`, `game-content/`, extracted game images/music, or local settings. Game assets come from each user's own installation; `.gitignore` excludes extracted assets, and packages must ship code only.

## Agent skills

### Issue tracker

Issues and specs are local Markdown under `docs/local/issues/`. See `docs/local/agents/issue-tracker.md`.

### Triage labels

Use the five standard triage roles. See `docs/local/agents/triage-labels.md`.

### Domain docs

This is a single-context repo; read the glossary and relevant ADRs under `docs/local/`. See `docs/local/agents/domain.md`.
