# AGENTS.md

Rules for the AI agent working in this project. Follow them in every task.

## 1. Plan first, verify the plan, then write code

Before touching any file:

1. Read the relevant files and understand how the current code works.
2. Write a short plan: what will change, which files, and why.
3. Check the plan against the code. Look for missing imports, wrong file paths, broken dependencies, and edge cases.
4. Only start writing code after the plan holds up.

If the request is unclear, ask one short question instead of guessing.

## 2. Always double check

- Re-read every change after writing it.
- Confirm that function names, variable names, and imports really exist. Never assume.
- Do not invent libraries, functions, or flags. If unsure, check the docs or the installed package.
- Keep changes small and focused. Do not refactor or rename things that were not asked for.

## 3. Use tests to catch problems

- Run the existing tests before changing anything, to know the starting state.
- After each change, run the tests again.
- If there is no test for the changed behavior, write a small one.
- If a test fails, find the cause and fix it. Never delete or weaken a test just to make it pass.
- If tests cannot be run (missing tool, no test setup), say so clearly and explain how the change was checked instead.

## 4. Verify everything before the final report

Before saying the work is done, confirm:

- [ ] The code runs without errors
- [ ] All tests pass
- [ ] Only the intended files were changed (check with `git status` and `git diff`)
- [ ] No debug prints, temporary files, or commented-out leftovers remain
- [ ] No secrets, tokens, or API keys were added

## 5. Briefing (final report)

When finished, give a short report with:

- **What changed**: list of files and a one-line reason for each
- **How it was verified**: which tests ran and their result
- **Risks or leftovers**: anything uncertain or not done
- **Suggested commit message**: one line, ready to copy

## 6. Git rules

- **Do NOT run `git commit`, `git push`, or `git add`.** The user does this manually.
- Read-only git commands are fine (`git status`, `git diff`, `git log`).
- Never run destructive git commands (`git reset --hard`, `git clean`, force push, branch deletion).

<!-- antislop:start -->
## antislop
For UI, copy, people, mobile layout, or code comments work, read these installed skill files directly (use these paths even if a same-named global skill exists):
- Core filter, always on: `antislop`: `.codex/skills/antislop/SKILL.md`
- People: `antislop-human`: `.codex/skills/antislop-human/SKILL.md`
- Mobile / responsive: `antislop-layoutmobile`: `.codex/skills/antislop-layoutmobile/SKILL.md`
- Code comments: `antislop-code`: `.codex/skills/antislop-code/SKILL.md`
- Copy & text: `antislop-copywriting`: `.codex/skills/antislop-copywriting/SKILL.md`
Before starting, follow the core's "Two Usage Modes" section in strict order: explicit session instruction first, then global preference, then ask. A session instruction always wins. For a resolved mode, say `antislop active: <mode> (session override).` or `antislop active: <mode> (global preference).` once before presenting findings or making edits, using the actual mode and source. Acknowledging the user's request without naming the source does not replace this notice.
Only an explicit choice of antislop during or after selects a session mode. A request to review, audit, or avoid file edits does not select a mode; read the global preference in that case. Another skill's mode does not select antislop's mode.
If the mode is unresolved, ask during/after and end the response; wait for the answer before any UI review, planning, or concept. For read-only tasks, put the active-mode notice only at the start of the final answer, never in progress messages. For editing tasks, announce before the first edit and omit it from the final answer.
To update antislop later: `npx antislop-ai --update`, or run `npx antislop-ai` and pick Overwrite them.
<!-- antislop:end -->
