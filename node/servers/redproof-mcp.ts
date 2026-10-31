import {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StdioServerTransport} from "@modelcontextprotocol/sdk/server/stdio.js";
import {z} from "zod";

const API = (process.env["REDPROOF_API"] ?? 'https://redproof.dev/api/v1').replace(/\/$/, '');
const SITE = API.replace(/\/api\/v1$/, '');
const server = new McpServer({name: 'redproof', version: '0.1.0'});

interface Finding {
    severity: string;
    title: string;
    plain: string;
    fixPrompt: string;
    locations: Array<{ file: string; line?: number | null }>;
}

interface ScanView {
    token: string;
    status: 'queued' | 'scanning' | 'scored' | 'failed';
    error: string | null;
    source: string;
    score: number | null;
    counts: Record<string, number>;
    paid: boolean;
    findings: Finding[];
    locked: Array<{ severity: string }>;
}

const text = (t: string, isError = false) => ({
    content: [{type: 'text' as const, text: t}],
    isError
})

async function api<T>(path: string, init?: RequestInit) {
    const response = await fetch(`${API}${path}`, {
        ...init,
        headers: {'content-type': 'application/json', ...init?.headers},
        signal: AbortSignal.timeout(30_000)
    });
    const body = (await response.json().catch(() => ({}))) as T & { message?: string | string[] };
    if (!response.ok) throw new Error(Array.isArray(body.message) ? body.message.join('; ') : (body.message ?? `HTTP ${response.status}`));
    return body;
}

server.registerTool(
    'scan_github_repo',
    {
        title: 'Start a Redproof scan',
        description:
            'Start a security check of a public GitHub repository built with AI tools (Lovable, Bolt, Cursor...). ' +
            'Only for code the user owns or may have reviewed: ask them first and set owner_confirmed only after they say yes. ' +
            'Returns a token; call get_report with it after about a minute.',
        inputSchema: {
            url: z.string().url().describe('Github repository URL, e.g. https://github.com/owner/repo'),
            owner_confirmed: z.boolean().describe('True only if the user confirmed they own this code or are allowed to have it reviewed')
        },
        annotations: {
            readOnlyHint: false,
            openWorldHint: true,
        }
    },
    async ({url, owner_confirmed}) => {
        if (!owner_confirmed) return text("Not started: ask the user to confirm they own this code or are allowed to have it reviewed.", true);
        try {
            const scan = await api<{ token: string }>('/scans/github', {
                method: 'POST',
                body: JSON.stringify({url, confirmOwnership: true})
            });
            return text(`Scan started. token: ${scan.token}\nReport: ${SITE}/report/${scan.token}\nCall get_report with this token in about a minute.`);
        } catch (error) {
            return text(`Could not start the scan: ${(error as Error).message}`, true);
        }
    }
);

server.registerTool(
    'get_report',
    {
        title: 'Read a Redproof report',
        description: 'Read tje score and findings of a Redproof scan, with the exact files and a fix prompt per finding',
        inputSchema: {token: z.string().regex(/^[A-Za-z0-9_-]{43}$/).describe('The token returned by scan_github_repo')},
        annotations: {
            readOnlyHint: true,
            openWorldHint: true,
        }
    },
    async ({token}) => {
        try {
            const scan = await api<ScanView>(`/scans/${token}`);

            if (scan.status === 'queued' || scan.status === 'scanning') {
                return text(`Still ${scan.status}. Try again in 30 seconds.`);
            }
            if (scan.status === 'failed') {
                return text(`The scan failed: ${scan.error ?? 'unknown error'}`, true);
            }

            const countParts: string[] = [];
            for (const [severity, count] of Object.entries(scan.counts)) {
                if (count > 0) countParts.push(`${count} ${severity}`);
            }
            const counts = countParts.length > 0 ? countParts.join(', ') : 'no issues';

            const lines = [`${scan.source}: ${scan.score}/100 (${counts})`, `Report: ${SITE}/report/${scan.token}`, ''];

            for (const finding of scan.findings) {
                const where = finding.locations.slice(0, 3).map((l) => (l.line ? `${l.file}:${l.line}` : l.file)).join(', ');
                lines.push(`## [${finding.severity}] ${finding.title}`, finding.plain, where ? `Where: ${where}` : '', `Fix prompt: ${finding.fixPrompt}`, '');
            }

            if (!scan.paid && scan.locked.length) {
                lines.push(`${scan.locked.length} more finding(s) are in the full report at the link above.`);
            }

            const cleanLines: string[] = [];
            for (const line of lines) {
                const isSecondBlank = line === '' && cleanLines.at(-1) === '';
                if (!isSecondBlank) cleanLines.push(line);
            }
            return text(cleanLines.join('\n'));

        } catch (error) {
            return text(`Could not read the report: ${(error as Error).message}`, true);
        }
    }
)


server.connect(new StdioServerTransport()).catch(error => {
    console.error(error);
    process.exit(1);
});