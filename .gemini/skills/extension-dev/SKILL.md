---
name: extension-dev
description: Guidelines and best practices for developing and maintaining the antigravity-vscode extension (VS Code / Positron bridge to agy).
---

# antigravity-vscode Development Guidelines

Instructions and conventions for maintaining the `antigravity-vscode` extension.

## 1. Extension Architecture
- **Process Communication**: `agy` CLI process is spawned and managed via `src/processManager.ts`. It streams stdio JSON chunks.
- **Webview UI**: Built in `src/webview/main.ts` and styled in `media/main.css`.
- **VS Code Host**: Controlled in `src/extension.ts` and `src/chatWebviewProvider.ts`.

## 2. Image & Media Handling
- **Supported Formats**: PNG, JPG/JPEG, WebP, GIF, and SVG.
- **SVG Badges in README**: VS Code extension marketplace parser strictly rejects SVG image sources in README badge links. Always use `.png` URLs for shields badges in `README.md` (e.g. `img.shields.io/badge/...png`).
- **Pasted Images**: Handled in `chatWebviewProvider.ts` under `handleSavePastedImage`. Must handle data URLs like `data:image/svg+xml;base64,...` correctly by mapping `svg+xml` to `.svg`.

## 3. Build, Package & Installation Workflow for Testing
- **Compile Code**: Run `npm run build` to generate `dist/extension.js` and `dist/webview.js`.
- **Package VSIX**: Run `npx vsce package` to create `antigravity-vscode-<version>.vsix`.
- **Install Extension for Testing**:
  - Standard VS Code: `code --install-extension antigravity-vscode-<version>.vsix --force`
  - Positron (NixOS Workaround): The `positron-bin` Nix wrapper rejects CLI flags like `--install-extension`. Instead, sync built outputs directly into the extension directory:
    ```bash
    rsync -av dist/ ~/.positron/extensions/antigravity.antigravity-vscode-<version>/dist/
    rsync -av media/ ~/.positron/extensions/antigravity.antigravity-vscode-<version>/media/
    ```
- **Verification**: Verify changes using `git status` and `git diff`.

