/**
 * 跨平台语法检查。
 *
 * 为什么单独一个文件：npm 在 Windows 上经 `cmd.exe` 运行 scripts，不认
 * `for f in ...; do ...; done` 这种 POSIX 语法，原来的内联写法会让
 * `npm run check` 在 Windows 上直接失败（连带 `npm test` 与 `prepublishOnly`）。
 */
import { execFileSync } from "node:child_process";
import { readdirSync, existsSync } from "node:fs";

/** 与原来 `*.mjs servers/*.mjs test/*.mjs` 保持一致的覆盖范围。 */
const SCAN_DIRS = [".", "servers", "test"];

const files = SCAN_DIRS.flatMap(dir => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(entry => entry.endsWith(".mjs"))
    .map(entry => (dir === "." ? entry : `${dir}/${entry}`));
}).sort();

if (files.length === 0) {
  console.error("❌ 没有找到任何 .mjs 文件，检查路径配置");
  process.exit(1);
}

for (const file of files) {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}

console.log(`✅ 语法检查通过：${files.length} 个文件`);
