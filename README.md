---
title: HashStash
status: ready
---

# HashStash

Save prompts as Markdown files. Type `#` in any BB chat to find a prompt. Select it to insert its text, then edit before sending.

## Set your folder

HashStash uses `~/Documents/BB Prompts` by default. The folder belongs to the computer that runs the BB server. All projects on that server share the library.

To use another folder:

1. Open HashStash in the BB plugin configuration.
2. Set `Prompts folder` to a full path, such as `/Users/yourname/Documents/Prompts`.
3. Open HashStash in the sidebar to see the active folder.

Use a full path, not `~` or a relative path. HashStash creates the folder if it does not exist. The BB server must have permission to read and write there.

Changing the folder selects its files. It does not move your existing prompts. To move your library, copy its files before selecting the new folder.

## Save and use prompts

To save a prompt:

1. Open HashStash in the sidebar.
2. Enter a name and prompt text.
3. Select Save prompt.

To use a prompt:

1. Type `#` at the start of a chat message or after a space.
2. Type part of the name to narrow the list.
3. Select a prompt with the mouse, Enter, or Tab.
4. Edit the inserted text before sending.

The search matches letters in order. For example, `#crv` finds `Code review`. Arrow keys move through the matches. A space, punctuation, or line break closes the menu. Escape or leaving the message field also closes it.

## File rules

You can create or edit files with another editor. HashStash refreshes the library after file changes. Each prompt follows these rules:

- Use one UTF-8 file with a lowercase `.md` extension per prompt.
- Put files directly inside the selected folder, without subfolders.
- Use the filename as the name, such as `Code review.md`.
- Put only the prompt text inside the file.
- Use a unique name, even when names differ only in letter case.
- Keep names within 120 characters, excluding `.md`.
- Keep prompt text within 64,000 characters, with at least one non-space character.
- Use regular files, not symbolic links. A symbolic link points to another file.

Names cannot contain `< > : " / \ | ? *` or control characters. Names cannot end with a period or space. Spaces inside names are allowed.

Markdown headings and formatting are part of the prompt text. Metadata at the top of a file also becomes prompt text. HashStash does not replace template fields such as `{{file}}`. Replace them yourself after insertion.

If another editor changes a prompt, reload it before saving in HashStash. Copy any unsaved edits first. Avoid saving the same file in both editors at once.

## Install and develop

HashStash requires BB 0.44 or later. It needs no external service or API key. Plugins run with the permissions of the BB server.

Install the released version:

```sh
bb plugin install git:https://github.com/StreamlinedStartup/hashstash.git@^0.1.0
```

For development, install mise first. In this repository, run:

```sh
mise install
mise exec -- bun install
mise run typecheck
mise run test
mise run build
bb plugin install .
```

For automatic builds, run the development task in tmux:

```sh
tmux new-session -d -s hashstash-dev 'mise run dev'
```
