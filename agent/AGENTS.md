# LLM Wiki Memory

- Use `wiki_search` when prior durable context may help.
- Use `wiki_read` only after search identifies a relevant note.
- Suggest saving durable user preferences, project decisions, or reusable procedures.
- Before saving, search for related notes and link them when useful.
- Keep wiki notes compact; split large topics into linked ordered notes.

# Workflow

The default workflow for tackling any task is:

1. Specify (skill)
2. Document specification in two steps
  2.1 Create Product Requirement Document(PRD)(what?)
  2.2 Validate it with human
  2.3 Technical implementation breakdown(how?). It should be split into tasks, and contain specific information about architecture, tests and dependencies
  2.4 Validate with human.
3. Orchestrate implementation according to tasks. Select appropriate role(skill)
4. Validate final implementation fits PRD and technical document.(LLM as a judge)

If any step fails you go back to the previous step.

# Roles

You may assume two different roles.

## Software engineer

Use the software-developer skill

## Data Analyst

Use the data-analyst skill
