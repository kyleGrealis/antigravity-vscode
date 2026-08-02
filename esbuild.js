const esbuild = require('esbuild');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const isWatch = process.argv.includes('--watch');

function runTypeCheck() {
  console.log('Running tsc --noEmit...');
  execSync('npx tsc --noEmit', { stdio: 'inherit' });
}

function syncToInstalledExtension() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf-8'));
    const extensionsDir = path.join(os.homedir(), '.positron', 'extensions');
    if (!fs.existsSync(extensionsDir)) return;

    const targetDir = path.join(extensionsDir, `antigravity.antigravity-vscode-${pkg.version}`);
    let syncPath = fs.existsSync(targetDir) ? targetDir : null;

    if (!syncPath) {
      const entries = fs.readdirSync(extensionsDir);
      const match = entries.find(e => e.startsWith('antigravity.antigravity-vscode-'));
      if (match) {
        syncPath = path.join(extensionsDir, match);
      }
    }

    if (syncPath) {
      fs.cpSync('dist', path.join(syncPath, 'dist'), { recursive: true });
      fs.cpSync('media', path.join(syncPath, 'media'), { recursive: true });
      console.log(`Synced build to ${syncPath}`);
    }
  } catch (err) {
    console.error('Failed to sync to installed extension:', err);
  }
}

async function main() {
  runTypeCheck();

  const extensionCtx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: false,
    sourcemap: true,
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    logLevel: 'info',
  });

  const webviewCtx = await esbuild.context({
    entryPoints: ['src/webview/main.ts'],
    bundle: true,
    format: 'iife',
    minify: false,
    sourcemap: true,
    platform: 'browser',
    outfile: 'dist/webview.js',
    logLevel: 'info',
  });

  if (isWatch) {
    await extensionCtx.watch();
    await webviewCtx.watch();
    console.log('Watching for changes...');
  } else {
    await extensionCtx.rebuild();
    await extensionCtx.dispose();
    await webviewCtx.rebuild();
    await webviewCtx.dispose();
    syncToInstalledExtension();
    console.log('Build complete.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

