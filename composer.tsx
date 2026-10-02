import { useCallback, useEffect, useRef, useState } from "react";
import { useComposer, useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { Prompt, rpcContract } from "./server";
import { fuzzyScore } from "./search";

export function promptQuery(beforeCaret: string) {
  const hash = /(?:^|\s)#([\p{L}\p{N}_-]*)$/u.exec(beforeCaret);
  if (hash) return { from: beforeCaret.length - hash[1]!.length - 1, to: beforeCaret.length, query: hash[1]! };
  return null;
}

// BB exposes draft writes through the SDK, but caret reads currently need its editor DOM.
export function editorText(node: Node): string {
  if (node.nodeType === 3) return node.textContent ?? "";
  if (node instanceof HTMLElement) {
    const mention = node.getAttribute("data-prompt-mention-serialized-text");
    if (mention !== null) return mention;
    if (node.tagName === "BR") return "\n";
  }
  const blocks = node.nodeType === 11 || (node instanceof HTMLElement && ["OL", "UL"].includes(node.tagName));
  return Array.from(node.childNodes).map(editorText).join(blocks ? "\n" : "");
}

type CaretMatch = NonNullable<ReturnType<typeof promptQuery>> & { text: string; editor: HTMLElement };
export function PromptPicker() {
  const composer = useComposer();
  const rpc = useRpc<typeof rpcContract>();
  const owner = useRef<HTMLDivElement>(null);
  const api = useRef(composer);
  api.current = composer;
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const availability = useRef({ loading, error });
  availability.current = { loading, error };
  const [match, setMatch] = useState<CaretMatch | null>(null);
  const [selected, setSelected] = useState(0);
  const activeMatch = useRef<CaretMatch | null>(null);
  const choices = useRef<Prompt[]>([]);
  const index = useRef(0);
  const request = useRef(0);
  const reload = useCallback(async () => {
    const attempt = ++request.current;
    try {
      const result = await rpc.call("list");
      if (attempt === request.current) { setPrompts(result.prompts); setError(""); }
    } catch (cause) {
      if (attempt === request.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally { if (attempt === request.current) setLoading(false); }
  }, [rpc]);
  useEffect(() => { void reload(); return () => { request.current++; }; }, [reload]);
  useRealtime("prompts-changed", reload);
  const matches = prompts.map((prompt) => ({ prompt, score: fuzzyScore(prompt.name, match?.query ?? "") }))
    .filter(({ score }) => Number.isFinite(score)).sort((a, b) => a.score - b.score || a.prompt.name.localeCompare(b.prompt.name))
    .slice(0, 30).map(({ prompt }) => prompt);
  choices.current = matches;
  index.current = Math.min(selected, Math.max(0, matches.length - 1));
  const choose = useCallback((prompt: Prompt) => {
    const current = activeMatch.current;
    if (!current || api.current.text !== current.text) return;
    api.current.updateText((text) => text === current.text ? text.slice(0, current.from) + prompt.body + text.slice(current.to) : text);
    activeMatch.current = null;
    setMatch(null);
    api.current.focus();
  }, []);
  useEffect(() => {
    const shell = owner.current?.closest("[data-promptbox-shell]");
    if (!shell) return;
    let mounted = true;
    let dismissed: number | null = null;
    const sync = () => {
      if (!mounted) return;
      const selection = window.getSelection();
      const editor = selection?.anchorNode?.parentElement?.closest<HTMLElement>('[contenteditable="true"]');
      if (!selection?.isCollapsed || !editor || !shell.contains(editor) || document.activeElement !== editor) {
        activeMatch.current = null; setMatch(null); return;
      }
      const range = selection.getRangeAt(0).cloneRange();
      range.selectNodeContents(editor);
      range.setEnd(selection.anchorNode!, selection.anchorOffset);
      const before = editorText(range.cloneContents());
      const next = promptQuery(before);
      const text = api.current.text;
      if (!next || text.slice(0, before.length) !== before) {
        dismissed = null; activeMatch.current = null; setMatch(null); return;
      }
      if (dismissed === next.from) return;
      if (activeMatch.current?.query !== next.query || activeMatch.current?.from !== next.from) setSelected(0);
      const value = { ...next, text, editor };
      activeMatch.current = value; setMatch(value);
    };
    const onInput = () => queueMicrotask(sync);
    const onKey = (event: KeyboardEvent) => {
      if (!activeMatch.current || !shell.contains(event.target as Node) || event.isComposing) return;
      if (["Escape", "ArrowDown", "ArrowUp", "Enter", "Tab"].includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation();
        if (event.key === "Escape") {
          dismissed = activeMatch.current.from; activeMatch.current = null; setMatch(null);
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          const count = choices.current.length;
          if (count) setSelected((index.current + (event.key === "ArrowDown" ? 1 : count - 1)) % count);
        } else {
          const prompt = choices.current[index.current];
          if (prompt && !availability.current.loading && !availability.current.error) choose(prompt);
        }
      }
    };
    shell.addEventListener("input", onInput);
    shell.addEventListener("focusin", onInput);
    shell.addEventListener("focusout", onInput);
    document.addEventListener("selectionchange", sync);
    document.addEventListener("keydown", onKey, true);
    return () => {
      mounted = false;
      shell.removeEventListener("input", onInput);
      shell.removeEventListener("focusin", onInput);
      shell.removeEventListener("focusout", onInput);
      document.removeEventListener("selectionchange", sync);
      document.removeEventListener("keydown", onKey, true);
      activeMatch.current = null;
    };
  }, [choose, composer.scope.kind, JSON.stringify(composer.scope)]);
  return <div ref={owner} className="relative">
    {match && <div className="rounded-lg border border-border bg-popover p-2 text-popover-foreground shadow-lg">
      <p className="px-2 py-1 text-xs text-muted-foreground">Saved prompts</p>
      {error ? <p role="alert" className="p-2 text-sm text-destructive">{error} <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => void reload()}>Retry</button></p> : loading ? <p role="status" className="p-2 text-sm">Loading prompts...</p> : <div role="listbox" aria-label="Saved prompts" className="max-h-64 overflow-y-auto">
        {matches.length === 0 && <p className="p-2 text-sm text-muted-foreground">{prompts.length ? "No matching prompts." : "Save a prompt in the HashStash sidebar page."}</p>}
        {matches.map((prompt, position) => <button key={prompt.id} type="button" role="option" aria-selected={position === index.current} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(prompt)} className={`block w-full rounded-md px-2 py-2 text-left text-sm ${position === index.current ? "bg-accent text-accent-foreground" : "hover:bg-accent"}`}>
          <span className="block truncate font-medium">{prompt.name}</span><span className="block truncate text-xs text-muted-foreground">{prompt.body.replace(/\s+/g, " ").slice(0, 160)}</span>
        </button>)}
      </div>}
    </div>}
  </div>;
}
