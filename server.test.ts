import { afterEach, test } from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { createFakePluginHost, experimental_scanPublicSdkOnly } from "@get-bb/plugin-sdk/testing";
import plugin, { type Prompt } from "./server";
import { fuzzyScore } from "./search";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
test("persistence, fuzzy search, conflicts, and deletion", async () => {
  const directory = mkdtempSync(join(tmpdir(), "prompt-saver-"));
  cleanups.push(async () => rmSync(directory, { recursive: true }));
  let { bb, harness } = createFakePluginHost({ pluginId: "hashstash", settings: { promptsDirectory: directory } });
  await plugin(bb);
  cleanups.push(() => harness.lifecycle.dispose());
  const saved = await harness.behavior.callRpc("save", { name: "Code review", body: "Review {{file}}.\n  Keep indentation.\n" }) as Prompt;
  assert.deepEqual(harness.registrations.mentionProviders, []);
  assert.deepEqual(await harness.behavior.callRpc("get", { id: saved.id }), saved);
  await assert.rejects(harness.behavior.callRpc("save", { name: "code review", body: "Duplicate" }), /already exists/);
  await assert.rejects(harness.behavior.callRpc("save", { name: "Empty", body: "   " }));
  await assert.rejects(harness.behavior.callRpc("save", { id: saved.id, name: saved.name, body: "No revision" }));
  const edited = await harness.behavior.callRpc("save", { ...saved, body: "Updated" }) as Prompt;
  assert.notEqual(edited.revision, saved.revision);
  assert.equal(readFileSync(join(directory, saved.id), "utf8"), "Updated");
  await assert.rejects(harness.behavior.callRpc("save", { ...saved, body: "Stale" }), /changed or was deleted/);
  await assert.rejects(harness.behavior.callRpc("remove", { id: saved.id, revision: saved.revision }), /changed or was deleted/);
  ({ bb, harness } = await harness.lifecycle.reload(plugin));
  assert.deepEqual(await harness.behavior.callRpc("list", null), { prompts: [edited], directory });
  await harness.behavior.callRpc("remove", { id: saved.id, revision: edited.revision });
  await assert.rejects(harness.behavior.callRpc("get", { id: saved.id }), /deleted/);
  assert.deepEqual(await harness.behavior.callRpc("list", null), { prompts: [], directory });
});
test("Markdown imports, external edits, renames, and folder configuration", async () => {
  const directory = mkdtempSync(join(tmpdir(), "prompt-files-"));
  const other = mkdtempSync(join(tmpdir(), "prompt-other-"));
  cleanups.push(async () => { rmSync(directory, { recursive: true }); rmSync(other, { recursive: true }); });
  writeFileSync(join(directory, "Template.md"), "First\n");
  const { bb, harness } = createFakePluginHost({ pluginId: "hashstash", settings: { promptsDirectory: directory } });
  await plugin(bb);
  cleanups.push(() => harness.lifecycle.dispose());
  const original = await harness.behavior.callRpc("get", { id: "Template.md" }) as Prompt;
  writeFileSync(join(directory, "Template.md"), "External edit");
  await assert.rejects(harness.behavior.callRpc("save", { ...original, body: "Overwrite" }), /changed/);
  await assert.rejects(harness.behavior.callRpc("get", { id: "../Template.md" }));
  await assert.rejects(harness.behavior.callRpc("save", { name: "../Escape", body: "No" }));
  const current = await harness.behavior.callRpc("get", { id: "Template.md" }) as Prompt;
  const renamed = await harness.behavior.callRpc("save", { ...current, name: "New name" }) as Prompt;
  assert.equal(renamed.id, "New name.md");
  assert.equal(existsSync(join(directory, "Template.md")), false);
  assert.equal(readFileSync(join(directory, renamed.id), "utf8"), "External edit");
  await harness.behavior.setSettings({ promptsDirectory: other });
  assert.deepEqual(await harness.behavior.callRpc("list", null), { prompts: [], directory: other });
  assert.equal(existsSync(join(directory, renamed.id)), true);
});
test("legacy migration preserves conflicting files and does not restore deleted prompts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "prompt-migration-"));
  cleanups.push(async () => rmSync(directory, { recursive: true }));
  let { bb, harness } = createFakePluginHost({ pluginId: "hashstash", settings: { promptsDirectory: directory } });
  const db = bb.storage.database();
  bb.storage.migrate(db, [`CREATE TABLE prompts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      body TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1
    )`]);
  db.prepare("INSERT INTO prompts (id, name, body) VALUES (?, ?, ?)").run("legacy-1", "Existing", "Legacy text\n");
  writeFileSync(join(directory, "Existing.md"), "File text");
  await plugin(bb);
  cleanups.push(() => harness.lifecycle.dispose());
  assert.equal(readFileSync(join(directory, "Existing.md"), "utf8"), "File text");
  assert.equal(readFileSync(join(directory, "Existing (2).md"), "utf8"), "Legacy text\n");
  const migrated = await harness.behavior.callRpc("get", { id: "Existing (2).md" }) as Prompt;
  await harness.behavior.callRpc("remove", { id: migrated.id, revision: migrated.revision });
  ({ bb, harness } = await harness.lifecycle.reload(plugin));
  assert.equal(existsSync(join(directory, migrated.id)), false);
  assert.equal((bb.storage.database().prepare("SELECT body FROM prompts").get() as { body: string }).body, "Legacy text\n");
});
test("fuzzy matching ranks exact and contiguous matches first", () => {
  assert.equal(fuzzyScore("Code review", "CODE REVIEW"), 0);
  assert.ok(fuzzyScore("Code review", "review") < fuzzyScore("Code review", "crv"));
  assert.equal(fuzzyScore("Code review", "xyz"), Infinity);
  assert.equal(fuzzyScore("Code review", ""), 0);
});
test("public SDK imports", () => {
  const result = experimental_scanPublicSdkOnly(import.meta.dirname, {
    allow: [/^react$/, /^@\//, /^@radix-ui\/react-slot$/, /^class-variance-authority$/, /^clsx$/, /^tailwind-merge$/, /^jsdom$/, /^@testing-library\/react$/],
  });
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.privateDependencies, []);
});
