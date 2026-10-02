import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createElement } from "react";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
const { act, fireEvent, waitFor } = await import("@testing-library/react");
const { renderSlot } = await import("@get-bb/plugin-sdk/testing/app");
const { PromptPicker, promptQuery, editorText } = await import("./composer");

test("bare hash opens, normal text dismisses, and slash text does not open the picker", () => {
  assert.deepEqual(promptQuery("#"), { from: 0, to: 1, query: "" });
  assert.deepEqual(promptQuery("Before #crv"), { from: 7, to: 11, query: "crv" });
  for (const text of ["# ", "#crv ", "#crv.", "##", "abc#", "#\n", "#crv\t", "#crv,", "#crv/", "A # heading"]) assert.equal(promptQuery(text), null, text);
  assert.equal(promptQuery("/saved-prompts"), null);
  assert.equal(promptQuery("/saved-prompts "), null);
  assert.equal(promptQuery("/saved-prompts:crv"), null);
  assert.equal(promptQuery("/something-else"), null);
});
test("caret serialization preserves multiline text and mention offsets", () => {
  const fragment = document.createDocumentFragment();
  const container = document.createElement("div");
  container.innerHTML = '<p>Before <span data-prompt-mention-serialized-text="@file.ts">File</span></p><p>#crv</p>';
  fragment.append(...container.childNodes);
  assert.equal(editorText(fragment), "Before @file.ts\n#crv");
});
test("picker opens on #, closes on space, supports keyboard selection and editable insertion", async () => {
  const TestComposer = () => createElement("div", { "data-promptbox-shell": "" }, createElement(PromptPicker), createElement("div", { contentEditable: true, tabIndex: 0 }));
  const slot = renderSlot({ component: TestComposer }, {}, {
    composer: { text: "#", scope: { kind: "thread", threadId: "thread-1" }, attachmentCount: 1 },
    rpc: { list: async () => ({ prompts: [{ id: "prompt-1", name: "Code review", body: "Review {{file}}.", revision: "revision-1" }] }) },
  });
  const editor = slot.container.querySelector<HTMLElement>('[contenteditable="true"]')!;
  const input = async (text: string) => {
    await slot.behavior.setComposerText(text);
    editor.innerHTML = "";
    const p = document.createElement("p"); p.textContent = text; editor.append(p);
    editor.focus();
    const range = document.createRange(); range.selectNodeContents(p); range.collapse(false);
    window.getSelection()!.removeAllRanges(); window.getSelection()!.addRange(range);
    await act(async () => { fireEvent.input(editor); });
  };
  try {
    await input("#");
    await slot.findByRole("listbox", { name: "Saved prompts" });
    await input("# ");
    assert.equal(slot.queryByRole("listbox"), null);
    await input("Before #crv");
    await slot.findByRole("option", { name: /Code review/ });
    await act(async () => { fireEvent.keyDown(editor, { key: "Escape" }); });
    assert.equal(slot.queryByRole("listbox"), null);
    await input("Plain text");
    await input("Before #");
    await slot.findByRole("listbox");
    await act(async () => { fireEvent.keyDown(editor, { key: "Tab" }); });
    await waitFor(() => assert.equal(slot.inspection.composer.text, "Before Review {{file}}."));
    assert.equal(slot.inspection.composer.attachmentCount, 1);
    await input("My edited template");
    assert.equal(slot.inspection.composer.text, "My edited template");
    await input("/saved-prompts ");
    assert.equal(slot.queryByRole("listbox"), null);
  } finally { slot.lifecycle.unmount(); }
});
