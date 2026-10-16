import { readFile, rm } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const outdir = resolve(root, "lib");

const cssPlugin = {
  name: "dsh-openui-css",
  setup(buildContext) {
    buildContext.onLoad({ filter: /\.css$/ }, async ({ path }) => {
      const css = await readFile(path, "utf8");
      const id = `dsh-openui/${basename(path)}`;
      return {
        loader: "js",
        contents: `
const id = ${JSON.stringify(id)};
if (document.querySelector('style[data-plugin-css=' + JSON.stringify(id) + ']') === null) {
  const style = document.createElement('style');
  style.dataset.plugin = 'dsh-openui';
  style.dataset.pluginCss = id;
  style.textContent = ${JSON.stringify(css)};
  document.head.appendChild(style);
}
`,
      };
    });
  },
};

await rm(outdir, { recursive: true, force: true });

await build({
  entryPoints: [resolve(root, "src/host/index.ts")],
  outfile: resolve(outdir, "index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  sourcemap: true,
  external: ["@deepseek-ai/*", "@deepseek-ai/cordis"],
});

await build({
  entryPoints: [resolve(root, "src/client/index.tsx")],
  outfile: resolve(outdir, "client.js"),
  bundle: true,
  platform: "browser",
  format: "cjs",
  target: "chrome120",
  sourcemap: true,
  minify: false,
  plugins: [cssPlugin],
  external: ["react", "react/jsx-runtime", "react-dom", "react-dom/client"],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  banner: {
    js: `window.__ModuleLoader__.load({ id: "dsh-openui", factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
  },
  footer: {
    js: `return module.exports; } });`,
  },
});
