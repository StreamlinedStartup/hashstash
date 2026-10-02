import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { definePluginApp, useRealtime, useRealtimeConnectionState, useRpc } from "@get-bb/plugin-sdk/app";
import type { Prompt, rpcContract } from "./server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PromptPicker } from "./composer";

function PromptsPage() {
  const rpc = useRpc<typeof rpcContract>();
  const connection = useRealtimeConnectionState();
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [directory, setDirectory] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Prompt | null>(null);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const request = useRef(0);
  const report = useCallback((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)), []);
  const reload = useCallback(async () => {
    const current = ++request.current;
    try {
      const result = await rpc.call("list");
      if (current === request.current) { setPrompts(result.prompts); setDirectory(result.directory); }
    } catch (cause) {
      if (current === request.current) report(cause);
    } finally {
      if (current === request.current) setLoading(false);
    }
  }, [rpc, report]);
  useEffect(() => { void reload(); return () => { request.current++; }; }, [reload, connection]);
  useRealtime("prompts-changed", reload);
  const dirty = name !== (selected?.name ?? "") || body !== (selected?.body ?? "");
  const edit = (prompt: Prompt | null) => {
    if (dirty && !window.confirm("Discard your unsaved prompt changes?")) return; // ubs:ignore native confirmation protects unsaved edits.
    setSelected(prompt);
    setName(prompt?.name ?? "");
    setBody(prompt?.body ?? "");
    setDeleting(false);
    setError("");
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const saved = await rpc.call("save", { name, body, ...(selected ? { id: selected.id, revision: selected.revision } : {}) });
      setSelected(saved);
      setName(saved.name);
      setBody(saved.body);
      await reload();
    } catch (cause) { report(cause); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError("");
    try {
      await rpc.call("remove", { id: selected.id, revision: selected.revision });
      setSelected(null);
      setName("");
      setBody("");
      setDeleting(false);
      await reload();
    } catch (cause) { report(cause); }
    finally { setBusy(false); }
  };
  const stale = selected && !loading && prompts.find((prompt) => prompt.id === selected.id)?.revision !== selected.revision;
  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-xl font-semibold">HashStash</h1>
        <p className="mt-1 text-sm text-muted-foreground">Type # in any chat. Select a prompt and edit its text before sending.</p>
        {directory && <p className="mt-2 break-all text-xs text-muted-foreground">Folder: {directory}. Change it in the plugin configuration.</p>}
        {error && <p role="alert" className="mt-4 text-sm text-destructive">{error} <Button variant="ghost" onClick={() => { setError(""); void reload(); }}>Retry</Button></p>}
        <div className="mt-6 grid gap-6 md:grid-cols-[16rem_1fr]">
          <section aria-label="Prompt library" className="space-y-3">
            <Button className="w-full" disabled={busy} onClick={() => edit(null)}>New prompt</Button>
            <Input aria-label="Search saved prompts" placeholder="Search names" value={query} onChange={(event) => setQuery(event.target.value)} />
            {loading ? <p role="status" className="text-sm text-muted-foreground">Loading prompts...</p> : prompts.length === 0 ? <p className="text-sm text-muted-foreground">Save your first prompt using the form.</p> : (
              <ul className="space-y-1">
                {prompts.filter((prompt) => prompt.name.toLowerCase().includes(query.toLowerCase())).map((prompt) => (
                  <li key={prompt.id}><button type="button" disabled={busy} aria-pressed={selected?.id === prompt.id} onClick={() => edit(prompt)} className={`w-full rounded-md px-3 py-2 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selected?.id === prompt.id ? "bg-accent text-accent-foreground" : "text-foreground"}`}>
                    <span className="block truncate font-medium">{prompt.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{prompt.body}</span>
                  </button></li>
                ))}
              </ul>
            )}
          </section>
          <form onSubmit={save} className="space-y-4">
            <h2 className="font-medium">{selected ? "Edit prompt" : "New prompt"}</h2>
            {stale && <p role="alert" className="text-sm text-destructive">This prompt changed or was deleted in another window. Copy your edits before reloading it. <Button variant="ghost" type="button" disabled={busy} onClick={() => edit(prompts.find((prompt) => prompt.id === selected.id) ?? null)}>Reload prompt</Button></p>}
            <div className="space-y-2"><label htmlFor="prompt-name" className="text-sm font-medium">Name</label><Input id="prompt-name" required maxLength={120} disabled={busy} value={name} placeholder="Code review" onChange={(event) => setName(event.target.value)} /></div>
            <div className="space-y-2"><label htmlFor="prompt-body" className="text-sm font-medium">Prompt text</label><textarea id="prompt-body" required maxLength={64000} disabled={busy} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Review the changes for bugs and missing tests." className="min-h-80 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" /></div>
            <div className="flex items-center gap-2"><Button type="submit" disabled={busy || !dirty || !name.trim() || !body.trim() || Boolean(stale)}>{busy ? "Saving..." : "Save prompt"}</Button>{selected && <Button variant="ghost" type="button" disabled={busy} onClick={() => setDeleting(true)}>Delete</Button>}</div>
            {deleting && <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3" role="alert"><span className="text-sm">Delete "{selected?.name}"?</span><Button type="button" variant="destructive" disabled={busy || Boolean(stale)} onClick={() => void remove()}>Delete prompt</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => setDeleting(false)}>Cancel</Button></div>}
          </form>
        </div>
      </div>
    </div>
  );
}

export default definePluginApp((app) => {
  app.composer.customize({
    id: "saved-prompt-picker",
    banners: [{ id: "prompt-picker", chrome: "bare", component: PromptPicker }],
  });
  app.slots.navPanel({ id: "prompts", title: "HashStash", icon: "Bookmark", path: "prompts", component: PromptsPage });
});
