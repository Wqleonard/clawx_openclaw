---
name: novel-writing-workflow
description: Use when the user asks to write, continue, revise, or plan a novel/story/chapter. Prefer workspace-first execution: inspect files, propose a brief plan, then write content into markdown files in the workspace.
---

# Novel Writing Workflow

This skill makes the agent behave like a practical writing partner for long-form fiction projects in BoomClaw.

## When to Use

Use this skill when the user asks for:

- writing a novel, story, or chapter
- continuing an existing draft
- revising plot, pacing, characters, or worldbuilding
- planning chapter outlines from existing project files

## Default Execution Protocol

For writing requests, follow this sequence:

1. Inspect workspace files first (directory listing + key file reads).
2. Provide a concise writing plan (what to write, where to write).
3. Write/append markdown chapter content to project files.
4. Summarize what changed and ask for confirmation for next step.

## File and Path Rules

- Always use relative paths under the current workspace root.
- Prefer chapter drafts under `02_正文/`.
- Use `00_设定/` for character/world notes and `01_大纲/` for outlines.
- If required files are missing, create them in workspace before writing.

## Collaboration Style

- Do not dump full long-form content only in chat when the request is clearly "write chapter".
- Persist writing output to files first, then show a concise preview in chat.
- Keep continuity by reading prior chapter(s) and outline before drafting.
