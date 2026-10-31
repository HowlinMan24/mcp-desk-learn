# Lesson 8: Harden it and explain it

**Goal:** try the real API, find the weak spots, and tell the story of the project well.
**Time:** 1 to 2 hours.

## 1. Try real Claude

Everything so far used the fake. Now use the real thing once:

```bash
unset ANTHROPIC_BASE_URL
export ANTHROPIC_API_KEY=<your key>
cd node && npx tsx src/cli.ts stream "Say hello in Macedonian"
```

This costs a small amount of money. Expect some surprises: the fake only proves your code handles
the format. Beta headers and request fields may be refused, and a real model will not follow the
fake's script. Fix what breaks, and treat that as part of the lesson.

To scan a real repo, unset `REDPROOF_API` too. That runs against the production redproof.dev.

## 2. Security review

Go through this list in your own code. For each item, find the line that protects it.

| Threat | Protection |
|---|---|
| Web page reaches Node | `contextIsolation`, `sandbox`, no `nodeIntegration` |
| Script in model output | Text only, strict CSP |
| Tool result gives orders | System prompt treats results as data, user approves tools |
| MCP server steals the API key | Minimal child environment |
| Half-written tool input | Validation, `max_tokens` check |
| Endless tool loop | Round limit |
| Request floods the API | Body limit. **Rate limiting is missing** |
| Stranger calls the API | Bound to localhost, optional bearer token |
| Database credentials in code | Environment variable |

Pick the missing one and add it, or explain how you would.

## 3. Make it job-ready (pick one or two)

- **Tests.** Add unit tests for `toDisplay` with Vitest and Go's `testing`. Add one integration
  test for `Store` against the real Postgres.
- **Docker.** Write a Dockerfile for the Go server. A multi-stage build gives a tiny image. Try
  the same for Node and compare the sizes.
- **Migration practice.** Add a `tokens_used` column to `messages` in both tracks. Think about
  existing rows.
- **Logging.** Add structured logs with `pino` and Go's `log/slog`.
- **CI.** A GitHub Action that starts Postgres and runs `tools/check.mjs`.

## 4. Your story

Practise saying this out loud, in your own words, in under two minutes:

1. **The problem.** I wanted to understand how an AI assistant works end to end.
2. **What it is.** A desktop assistant that streams Claude, uses tools through MCP, and asks before
   each tool call. I also wrote an MCP server for my own product.
3. **One hard part.** Pick something you truly struggled with.
4. **A trade-off.** For example, eager input streaming looks better but means I validate input
   myself.
5. **Honest scope.** I built the first version with AI help and rebuilt it myself to learn it.
   It has no packaging yet, and it only supports stdio.

Be honest about the AI help. The posting asks for AI code generation experience, so using AI well
is a strength. Saying you know each line, and being able to prove it, is what matters.

## Done when

- [ ] One real Claude call worked, or you know exactly why it did not
- [ ] You went through the security table
- [ ] You finished one job-ready task
- [ ] `/quiz call` scores mostly Solid

## Interview questions

- What is the biggest weakness in this project today?
- How would you add a remote MCP server over HTTP?
- What would you change before giving this to real users?
- Why did you use Prisma in one track and GORM in the other?
