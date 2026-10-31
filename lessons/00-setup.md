# Lesson 0: Setup and the big picture

**Goal:** everything runs on your laptop, and you can draw the system from memory.
**Time:** 45 minutes.

## 1. See the finished thing first

Open the map of the system:

```bash
open docs/explainers/architecture.html
```

Start the database and the fake services:

```bash
docker compose up -d --wait     # PostgreSQL on port 5544
node tools/fakes.mjs            # keep this running in a second terminal
```

Watch the finished code pass all its tests:

```bash
cd reference/node && npm install && cd ../..
node tools/check.mjs all ref-node
```

Now try it by hand. Stream a fake answer:

```bash
source tools/env.sh node
cd reference/node
DATABASE_URL=postgresql://desk:desk@127.0.0.1:5544/ref_node npx tsx src/cli.ts stream "hello"
cd ../..
```

## 2. Why fakes?

Real Claude costs money and gives a different answer every time. Tests need the same answer every
time. `tools/fakes.mjs` speaks the same format as the real API, and your code does not know the
difference. This is a normal backend habit: never make your tests depend on an outside service.

Open `http://127.0.0.1:47101/_requests` in the browser. You see exactly what the code sent to
"Claude". Use this page whenever you debug.

## 3. Create your Node project

```bash
cd node
npm init -y
npm pkg set type=commonjs
npm i @anthropic-ai/sdk @modelcontextprotocol/sdk ajv ajv-formats zod
npm i -D typescript tsx @types/node
npx tsc --init
cd ..
```

Replace `node/tsconfig.json` with the settings from `reference/node/tsconfig.json`, and read each
line. `strict: true` is the important one.

## 4. Create your Go project

```bash
cd go
go mod init mcpdesk
go get github.com/anthropics/anthropic-sdk-go@v1.84.0
go get github.com/modelcontextprotocol/go-sdk@v1.8.0
cd ..
```

The first Go build of the Anthropic SDK takes a few minutes. After that it is cached.

## Compare

| | Node | Go |
|---|---|---|
| Dependency file | `package.json` | `go.mod` |
| Exact versions | `package-lock.json` | `go.sum` (also checksums) |
| Runs code | `tsx` runs TypeScript directly | `go run` compiles, then runs |
| Output | JavaScript, needs Node | One binary, needs nothing |
| Project layout | Your choice | `cmd/` for programs, `internal/` for private code |

## Done when

- [ ] `check.mjs all ref-node` passes on your laptop
- [ ] `node/` has a `package.json`, `go/` has a `go.mod`
- [ ] You can draw the parts and one turn from memory, on paper

## Interview questions

- Why is a fake better than the real service in tests? When is it not enough?
- What does an agent do that a plain chatbot does not?
