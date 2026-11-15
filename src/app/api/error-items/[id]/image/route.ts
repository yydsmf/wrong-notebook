import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { unauthorized, notFound, badRequest, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";

const logger = createLogger('api:error-items:image');

/** 与新建错题时的上限一致 */
const MAX_IMAGE_LENGTH = 20 * 1024 * 1024;

const bodySchema = z.object({
    imageDataUrl: z.string()
        .max(MAX_IMAGE_LENGTH)
        .regex(/^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/),
});

/**
 * PUT /api/error-items/:id/image
 * 替换（或补充）原题图片；题目文字、配图等其他内容不变
 */
export async function PUT(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    try {
        const user = await getCurrentUser();
        if (!user) {
            return unauthorized("Authentication required");
        }

        const parsed = bodySchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) {
            return badRequest("INVALID_IMAGE");
        }

        const item = await prisma.errorItem.findUnique({ where: { id }, select: { userId: true } });
        if (!item || item.userId !== user.id) {
            return notFound("Item not found");
        }

        await prisma.errorItem.update({ where: { id }, data: { originalImageUrl: parsed.data.imageDataUrl, originalImageUrls: null } });
        logger.info({ errorItemId: id, imageLength: parsed.data.imageDataUrl.length }, 'Original image replaced');
        return NextResponse.json({ originalImageUrl: parsed.data.imageDataUrl });
    } catch (error) {
        logger.error({ error }, 'Error replacing original image');
        return internalError("Failed to replace image");
    }
}
