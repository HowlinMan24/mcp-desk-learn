import {Anthropic} from "@anthropic-ai/sdk";
import {Store} from "./main/db";
import {McpHub} from "./main/mcp";

import {dirname} from "node:path";


function getEnv(name: string) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} is not set`);
    }
    return value;
}

async function stream(text: string) {
    const messageStream = new Anthropic().messages.stream({
        model: 'claude-opus-5-5',
        max_tokens: 1024,
        messages: [{role: 'user', content: text}]
    });
    messageStream.on('text', (delta) => process.stdout.write(delta));
    await messageStream.finalMessage();
    process.stdout.write('\n');
}


async function dbSmoke() {
    if (!process.env['DATABASE_URL']) throw new Error('DATABASE_URL is missing!');
    const store = Store.open(process.env['DATABASE_URL']);
    const conversation = await store.create('smoke test');
    await store.append(conversation.id, {role: "user", content: [{type: 'text', text: 'hello'}]});
    await store.append(conversation.id, {role: "assistant", content: [{type: 'text', text: 'hi there'}]});
    console.log(JSON.stringify({
        id: conversation.id,
        listed: (await store.list()).some(it => it.id === conversation.id),
        messages: await store.messages(conversation.id)
    }));
    await store.close();
}

async function hubSmoke() {
    const configPath = process.env['MCP_CONFIG'];
    if (!configPath) throw new Error('MCP_CONFIG is missing!');
    const hub = new McpHub();
    await hub.connectAll(McpHub.readConfig(configPath), process.cwd());
    const tools = hub.definitions().map(it => it.name);
    const scan = tools.find(it => it.endsWith('scan_github_repo'))!;
    const valid = await hub.call(scan, {
        url: 'https://github.com/demo/app',
        owner_confirmed: true
    });
    const invalid = await hub.call(scan, {
        url: 'not a url',
        owner_confirmed: true
    });
    console.log(JSON.stringify({
        tools,
        errors: hub.getErrors(),
        valid,
        invalid
    }));
    await hub.close();
}

async function main() {
    const [command, arg = ''] = process.argv.slice(2);
    if (command === 'stream') {
        return stream(arg);
    }
    if (command === 'db-smoke') {
        return dbSmoke()
    }
    if (command === 'hub-smoke') {
        return hubSmoke();
    }
    throw new Error('Commands: stream <text> | db-smoke');
}

main().catch(error => {
    console.error(error);
    process.exit(1);
})