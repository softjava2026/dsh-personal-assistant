/**
 * 主动摘要冒烟测试：种子笔记 → collectDigest → formatDigest。
 *
 * 运行：node --test 或直接 `node test/digest.smoke.mjs`
 * （DSH Desktop 下：ELECTRON_RUN_AS_NODE=1 "<DSH Desktop 可执行>" test/digest.smoke.mjs）
 */
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveConfig } from "../config.mjs";
import { collectDigest, formatDigest } from "../digest.mjs";

const dir = mkdtempSync(join(tmpdir(), "pa-digest-"));
const store = join(dir, "notes.sqlite");

// 种子一条笔记
const db = new DatabaseSync(store);
db.exec(`
  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY, content TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
`);
const now = Date.now();
db.prepare("INSERT INTO notes VALUES (?,?,?,?,?)").run(
  "seed-1", "明天和产品部开会，记得带上原型图", ",会议,产品,", now, now,
);
db.close();

const config = resolveConfig({ noteStorePath: store });
const sections = await collectDigest(config, {
  resolveStorePath: c => c.noteStorePath,
  logger: console,
});

console.log("sections:", JSON.stringify(sections, null, 1));
const text = formatDigest(sections, 2400, "2026-09-13");
console.log("\n--- formatted ---\n" + text);

if (!text || !text.includes("产品部") || !text.includes("2026-09-13")) {
  console.error("\n❌ digest smoke FAILED");
  process.exit(1);
}
console.log("\n✅ digest smoke OK");
