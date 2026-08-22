---
name: extension-dev
description: Guidelines and best practices for developing and maintaining the Positronium extension (Positron / VS Code bridge to agy).
---

# Positronium Development Guidelines

Instructions and conventions for maintaining the `positronium` extension.

## 1. Extension Architecture
- **Process Communication**: `agy` CLI process is spawned and managed via `src/processManager.ts`. It streams stdio JSON chunks.
- **Webview UI**: Built in `src/webview/main.ts` and styled in `media/main.css`.
- **VS Code / Positron Host**: Controlled in `src/extension.ts` and `src/chatWebviewProvider.ts`.

## 2. Image & Media Handling
- **Supported Formats**: PNG, JPG/JPEG, WebP, GIF, and SVG.
- **SVG Badges in README**: VS Code extension marketplace parser strictly rejects SVG image sources in README badge links. Always use `.png` URLs for shields badges in `README.md` (e.g. `img.shields.io/badge/...png`).
- **Pasted Images**: Handled in `chatWebviewProvider.ts` under `handleSavePastedImage`. Must handle data URLs like `data:image/svg+xml;base64,...` correctly by mapping `svg+xml` to `.svg`.

## 3. Build, Package & Installation Workflow for Testing
- **Compile Code**: Run `npm run build` to generate `dist/extension.js` and `dist/webview.js` (automatically syncs to `~/.positron/extensions/kylegrealis.positronium-<version>/`).
- **Package VSIX**: Run `npx vsce package` to create `positronium-<version>.vsix`.
- **Install Extension for Testing**:
  - Standard VS Code: `code --install-extension positronium-<version>.vsix --force`
  - Positron (NixOS Workaround): The `positron-bin` Nix wrapper rejects CLI flags like `--install-extension`. Instead, `esbuild.js` syncs build outputs directly to `~/.positron/extensions/kylegrealis.positronium-<version>/`.
- **Verification**: Verify changes using `git status` and `git diff`.

