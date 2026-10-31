import {Anthropic} from "@anthropic-ai/sdk";


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

async function main() {
    const [command, arg = ''] = process.argv.slice(2);
    if (command === 'stream') {
        return stream(arg);
    }
    throw new Error('Commands: stream <text>');
}

main().catch(error => {
    console.error(error);
    process.exit(1);
})