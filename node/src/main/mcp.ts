import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from "@modelcontextprotocol/sdk/client/stdio.js";
import {readFileSync} from "node:fs";
import {Anthropic} from "@anthropic-ai/sdk";
import {Ajv, ValidateFunction} from "ajv";
import addFormats from 'ajv-formats';

interface ServerConfig {
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
}

interface HubTool {
    server: string;
    remoteName: string;
    definition: Anthropic.Tool;
    validate: ValidateFunction;
}

export interface ToolOutcome {
    text: string;
    isError: boolean;
}

const toolName = (server: string, tool: string) => `${server}__${tool}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);

export class McpHub {

    private readonly clients = new Map<string, Client>();
    private readonly errors: string[] = [];
    private readonly tools = new Map<string, HubTool>();
    private readonly ajv = addFormats(new Ajv({strict: false}));

    static readConfig(path: string) {
        const config = JSON.parse(readFileSync(path, 'utf8')) as { servers?: ServerConfig[] };
        return config.servers ?? [];
    }

    private async connect(config: ServerConfig, cwd: string) {
        const transport = new StdioClientTransport({
            command: config.command,
            args: config.args ?? [],
            cwd: cwd,
            env: {
                PATH: process.env.PATH ?? '',
                HOME: process.env.HOME ?? '',
                ...config.env
            },
            stderr: 'ignore'
        });

        const client = new Client({name: 'mcp-desk', version: '0.1.0'});
        await client.connect(transport);

        this.clients.set(config.name, client);

        const {tools} = await client.listTools();

        for (const tool of tools) {
            const name = toolName(config.name, tool.name);
            const schema = tool.inputSchema as Anthropic.Tool.InputSchema;
            this.tools.set(name, {
                server: config.name,
                remoteName: tool.name,
                validate: this.ajv.compile(schema),
                definition: {
                    name: name,
                    description: `[${config.name}] ${tool.description ?? tool.name}`,
                    input_schema: schema,
                    eager_input_streaming: true
                }
            })
        }
    }

    async call(name: string, input: unknown): Promise<ToolOutcome> {
        const tool = this.tools.get(name);

        if (!tool) {
            return {
                text: `Unknown tool ${name}`,
                isError: true,
            };
        }
        if (!tool.validate(input)) {
            return {
                text: JSON.stringify({
                    INVALID_INPUT: this.ajv.errorsText(tool.validate.errors),
                    received: input
                }),
                isError: true,
            }
        }

        const client = this.clients.get(tool.server);

        try {
            const result = await client!.callTool({
                name: tool.remoteName,
                arguments: input as Record<string, unknown>
            })
            const blocks = (result.content ?? []) as Array<{ type: string, text?: string }>;
            const text = blocks.map((b) => (b.type === 'text' ? b.text : `[${b.type} content]`)).join('\n') || '(no output)';
            return {
                text,
                isError: Boolean(result.isError),
            }
        } catch (error) {
            return {
                text: `Tool failed: ${error instanceof Error ? error.message : String(error)}`,
                isError: true
            };
        }

    }

    async connectAll(configs: ServerConfig[], cwd: string) {
        await Promise.all(configs.map(config => this.connect(config, cwd).catch((error: unknown) => {
            this.errors.push(`${config.name}: ${error instanceof Error ? error.message : String(error)}`);
        })));
    }

    async close() {
        await Promise.all([...this.clients.values()].map(it => it.close().catch(() => undefined)));
    }

    definitions() {
        const tools = [...this.tools.values()];
        return tools.map(tool => tool.definition).sort((a, b) => a.name.localeCompare(b.name));
    }

    getErrors() {
        return this.errors;
    }
}