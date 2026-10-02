import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const nameSchema = z.string().trim().min(1).max(120)
  .refine((name) => !/[<>:"/\\|?*\x00-\x1f]/.test(name) && !/[. ]$/.test(name) && name !== "." && name !== "..", "Use a filename without path separators or special characters.");
const idSchema = z.string().refine((id) => id.endsWith(".md") && nameSchema.safeParse(id.slice(0, -3)).success, "Invalid prompt filename.");
const fields = {
  name: nameSchema,
  body: z.string().max(64_000).refine((text) => text.trim().length > 0, "Enter prompt text."),
};
const promptSchema = z.object({
  id: idSchema,
  ...fields,
  revision: z.string().min(1),
});
export type Prompt = z.infer<typeof promptSchema>;
export const rpcContract = defineRpcContract({
  list: { input: z.null(), output: z.object({ prompts: z.array(promptSchema), directory: z.string() }) },
  get: { input: z.object({ id: idSchema }), output: promptSchema },
  save: {
    input: z.object({ ...fields, id: idSchema.optional(), revision: z.string().min(1).optional() })
      .refine((value) => Boolean(value.id) === Boolean(value.revision), "An edit needs an id and revision."),
    output: promptSchema,
  },
  remove: {
    input: z.object({ id: idSchema, revision: z.string().min(1) }),
    output: z.object({ removed: z.literal(true) }),
  },
});

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    promptsDirectory: {
      type: "string", label: "Prompts folder",
      description: "An absolute folder path. Each prompt is a Markdown file. Copy this folder to move your library.",
      default: join(homedir(), "Documents", "BB Prompts"),
      experimental_schema: z.string().refine(isAbsolute, "Enter an absolute folder path."),
    },
  });
  let directory = "";
  let watcher: FSWatcher | undefined;
  const changed = () => bb.realtime.publish("prompts-changed", {});
  const useDirectory = async () => {
    const next = (await settings.get()).promptsDirectory;
    if (next !== directory) {
      mkdirSync(next, { recursive: true });
      const nextWatcher = watch(next, changed);
      nextWatcher.unref();
      nextWatcher.on("error", (error) => { bb.log.error(`Prompt folder watcher failed: ${error.message}`); changed(); });
      watcher?.close();
      watcher = nextWatcher;
      directory = next;
    }
  };
  bb.onDispose(() => watcher?.close());
  settings.onChange(changed);
  await useDirectory();
  const get = (id: string): Prompt => {
    idSchema.parse(id);
    const file = join(directory, id);
    if (!existsSync(file)) throw new Error("This prompt was deleted. Choose another prompt from #.");
    if (!lstatSync(file).isFile()) throw new Error(`Prompt files must be regular files: ${id}`);
    const body = readFileSync(file, "utf8");
    return promptSchema.parse({ id, name: id.slice(0, -3), body, revision: createHash("sha256").update(body).digest("hex") });
  };
  const list = () => readdirSync(directory).filter((id) => id.endsWith(".md")).map(get)
    .sort((a, b) => a.name.localeCompare(b.name));
  const write = (id: string, body: string, exclusive = false) => {
    const file = join(directory, id);
    if (exclusive) { writeFileSync(file, body, { flag: "wx" }); return; }
    const temporary = join(directory, `.${randomUUID()}.tmp`);
    try { writeFileSync(temporary, body, { flag: "wx" }); renameSync(temporary, file); }
    finally { if (existsSync(temporary)) unlinkSync(temporary); }
  };

  // Keep the shipped migration and database intact as a backup.
  const db = bb.storage.database();
  bb.storage.migrate(db, [
    `CREATE TABLE prompts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      body TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1
    )`,
  ]);
  if (!await bb.storage.kv.get<boolean>("markdown-migrated")) {
    const legacy = db.prepare("SELECT id, name, body FROM prompts ORDER BY name").all() as { id: string; name: string; body: string }[];
    for (const prompt of legacy) {
      if (await bb.storage.kv.get<string>(`markdown-export:${prompt.id}`)) continue;
      const base = prompt.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "-").replace(/[. ]+$/, "").slice(0, 100) || "Prompt";
      let name = base;
      let suffix = 2;
      while (readdirSync(directory).some((file) => file.toLowerCase() === `${name}.md`.toLowerCase())) {
        const existing = readdirSync(directory).find((file) => file.toLowerCase() === `${name}.md`.toLowerCase())!;
        if (get(existing).body === prompt.body) { name = existing.slice(0, -3); break; }
        name = `${base} (${suffix++})`;
      }
      const id = `${name}.md`;
      if (!existsSync(join(directory, id))) write(id, prompt.body, true);
      await bb.storage.kv.set(`markdown-export:${prompt.id}`, id);
    }
    await bb.storage.kv.set("markdown-migrated", true);
  }
  bb.rpc.register(rpcContract, {
    list: async () => { await useDirectory(); return { prompts: list(), directory }; },
    get: async ({ id }) => { await useDirectory(); return get(id); },
    save: async ({ id, name, body, revision }) => {
      await useDirectory();
      if (id && get(id).revision !== revision) throw new Error("This prompt changed or was deleted. Reload it before saving.");
      const nextId = `${name}.md`;
      if (list().some((prompt) => prompt.id !== id && prompt.name.toLowerCase() === name.toLowerCase())) throw new Error("A prompt with this name already exists.");
      // ponytail: synchronous writes serialize plugin edits; external editors can still race between the revision read and rename.
      if (id && nextId !== id && nextId.toLowerCase() === id.toLowerCase()) {
        write(id, body);
        renameSync(join(directory, id), join(directory, nextId));
      } else {
        write(nextId, body, nextId !== id);
        if (id && nextId !== id) unlinkSync(join(directory, id));
      }
      changed();
      return get(nextId);
    },
    remove: async ({ id, revision }) => {
      await useDirectory();
      if (get(id).revision !== revision) throw new Error("This prompt changed or was deleted. Reload it before deleting.");
      unlinkSync(join(directory, id));
      changed();
      return { removed: true as const };
    },
  });
}
