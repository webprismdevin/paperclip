import esbuild from "esbuild";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, "..");
const distUi = path.join(packageRoot, "dist/ui");

// Ensure output directory exists
fs.mkdirSync(distUi, { recursive: true });

// 1. Compile Tailwind CSS
//    Scans src/ui/ for class usage and outputs only the utilities we actually use.
const cssInput = path.join(packageRoot, "src/ui/styles.css");
const cssOutput = path.join(distUi, "styles.css");

console.log("Building Tailwind CSS...");
execSync(
  `npx @tailwindcss/cli -i ${cssInput} -o ${cssOutput} --minify`,
  { cwd: packageRoot, stdio: "inherit" },
);

// 2. Bundle the UI with esbuild
//    The compiled CSS is injected into the JS bundle so the plugin
//    only needs to load a single file — no separate stylesheet link.
await esbuild.build({
  entryPoints: [path.join(packageRoot, "src/ui/index.tsx")],
  outfile: path.join(distUi, "index.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  sourcemap: true,
  external: [
    "react",
    "react-dom",
    "react/jsx-runtime",
    "@paperclipai/plugin-sdk/ui",
  ],
  // Inject the compiled Tailwind CSS into the bundle
  banner: {
    js: `/* Inject plugin Tailwind CSS */
(function(){
  if(typeof document!=='undefined'){
    var s=document.createElement('style');
    s.setAttribute('data-plugin','paperclip-chat');
    s.textContent=${JSON.stringify(fs.readFileSync(cssOutput, "utf-8"))};
    document.head.appendChild(s);
  }
})();`,
  },
  logLevel: "info",
});

console.log("UI build complete — JS bundle includes Tailwind CSS.");
