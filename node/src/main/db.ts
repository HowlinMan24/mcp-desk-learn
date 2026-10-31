import {Prisma, PrismaClient} from "../generated/prisma/client";
import {PrismaPg} from "@prisma/adapter-pg";


export class Store {
    private constructor(private readonly db: PrismaClient) {
    }

    static open(databaseUrl: string) {
        return new Store(new PrismaClient({
            adapter: new PrismaPg({
                connectionString: databaseUrl
            })
        }))
    }

    create(title: string) {
        return this.db.conversation.create({data: {title}});
    }

    list() {
        return this.db.conversation.findMany({orderBy: {updatedAt: 'desc'}, take: 100});
    }

    close() {
        return this.db.$disconnect();
    }

    async has(id: string) {
        return (await this.db.conversation.count({where: {id}})) > 0;
    }

    async messages(conversationId: string) {
        const messages = await this.db.message.findMany({
            where: {
                conversationId
            },
            orderBy: {
                seq: 'asc'
            }
        })
        return messages.map(message => ({role: message.role, content: message.content}));
    }

    async append(conversationId: string, message: { role: 'user' | 'assistant'; content: Prisma.InputJsonValue }) {
        await this.db.$transaction(async trx => {
            const latestMessage = await trx.message.aggregate({
                where: {
                    conversationId
                },
                _max: {
                    seq: true
                }
            });
            await trx.message.create({
                data: {
                    conversationId,
                    seq: (latestMessage._max.seq ?? -1) + 1,
                    role: message.role,
                    content: message.content
                }
            });
            await trx.conversation.update({
                where: {
                    id: conversationId
                },
                data: {
                    updatedAt: new Date()
                }
            });
        })
    }
}