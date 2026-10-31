import {Anthropic} from "@anthropic-ai/sdk";
import {Store} from "./main/db";


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

async function main() {
    const [command, arg = ''] = process.argv.slice(2);
    if (command === 'stream') {
        return stream(arg);
    }
    if (command === 'db-smoke') {
        return dbSmoke()
    }
    throw new Error('Commands: stream <text> | db-smoke');
}

main().catch(error => {
    console.error(error);
    process.exit(1);
})