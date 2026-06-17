# Superpowers Bootstrap

Superpowers skills are installed for this agent. At the start of each conversation, and before responding to any user task where a skill might apply, load the `using-superpowers` skill and follow its instructions.

In Pi, load a skill by reading its `SKILL.md` file from the configured skills directory or by using `/skill:using-superpowers` when available. Do this before taking implementation, research, planning, debugging, or review actions.

# LLM Wiki Memory

- Use `wiki_search` when prior durable context may help.
- Use `wiki_read` only after search identifies a relevant note.
- Suggest saving durable user preferences, project decisions, or reusable procedures.
- Before saving, search for related notes and link them when useful.
- Keep wiki notes compact; split large topics into linked ordered notes.
