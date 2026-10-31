# MCP Desk: learn it by rebuilding it

Rebuild a real AI assistant step by step, in **Node.js and Go side by side**, with Claude Code as
your tutor. You type the code. Claude explains, draws diagrams, checks your work and quizzes you.

## Start

Open this folder in a new terminal and run:

```bash
cd ~/Projects/mcp-desk-learn
claude
```

Then type `/lesson`. The tutor checks where you are and takes you to the next step.

## What you can type

| Command | What it does |
|---|---|
| `/lesson` | Start or continue the course |
| `/explain streaming` | Explain a topic with a diagram page in your browser |
| `/explain prisma vs gorm` | Compare Node and Go side by side |
| `/check` | Test your code for the current lesson |
| `/quiz` | Interview practice on what you built |

## The course

| # | Lesson | Node | Go | Skill for the job |
|---|---|---|---|---|
| 0 | Setup and the big picture | npm, tsx | go mod | Reading a system |
| 1 | Stream Claude token by token | Anthropic SDK | Anthropic SDK | LLM APIs, streaming |
| 2 | Database and migrations | **Prisma** | **GORM + goose** | ORMs, PostgreSQL, migrations |
| 3 | Build an MCP server | MCP SDK, zod | MCP Go SDK | MCP, developer tools |
| 4 | Build an MCP client | MCP SDK, Ajv | MCP Go SDK, jsonschema | Stdio, JSON Schema |
| 5 | The agent loop | Async events | Goroutines, context | Tool calling, approvals |
| 6 | REST API and SSE | `node:http` | `net/http` | Backend APIs, streaming |
| 7 | The user interface | **Electron** | Embedded web page | Secure IPC, frontend streaming |
| 8 | Harden and explain it | Both | Both | Security, interview stories |

Lessons 1 to 6 have automatic checks. Both languages must pass the same tests.

## You do not need an API key

`tools/fakes.mjs` runs a fake Claude and a fake Redproof on your laptop. So lessons are free and
work offline. The fake is scripted, so try a real key once at the end (lesson 8).

## Need to peek?

Finished code is in `reference/node` and `reference/go`. Try first. Compare after.

## Before Monday

The job is TypeScript, so do the Node track first. Go is for wider backend skills. Node lessons 0
to 5 are the priority for the call.
