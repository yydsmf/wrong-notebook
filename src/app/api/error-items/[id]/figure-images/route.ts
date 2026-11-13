import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { unauthorized, notFound, badRequest, internalError } from "@/lib/api-errors";
import { createLogger } from "@/lib/logger";
import {
    appendImageFragment,
    isImageFragmentDataUrl,
    MAX_IMAGE_FRAGMENT_LENGTH,
    MAX_IMAGE_FRAGMENTS,
    removeImageFragment,
} from "@/lib/image-fragments";

const logger = createLogger("api:error-items:figure-images");

const imageSchema = z.object({
    imageDataUrl: z.string().max(MAX_IMAGE_FRAGMENT_LENGTH).refine(isImageFragmentDataUrl, "INVALID_IMAGE"),
});

const deleteSchema = z.object({ fragmentId: z.string().min(1).max(100) });

async function findOwnedItem(id: string, userId: string) {
    const item = await prisma.errorItem.findUnique({
        where: { id },
        select: { userId: true, imageFragments: true },
    });
    return item && item.userId === userId ? item : null;
}

/** 追加一张用户本地裁剪的题目配图，不调用 AI，也不修改原题原图。 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    try {
        const user = await getCurrentUser();
        if (!user) return unauthorized("Authentication required");

        const item = await findOwnedItem(id, user.id);
        if (!item) return notFound("Item not found");

        const parsed = imageSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) return badRequest("INVALID_IMAGE");

        let result;
        try {
            result = appendImageFragment(item.imageFragments, parsed.data.imageDataUrl);
        } catch (error) {
            const code = error instanceof Error ? error.message : "";
            if (code === "IMAGE_FRAGMENT_LIMIT") return badRequest(`最多保存 ${MAX_IMAGE_FRAGMENTS} 张手动配图`);
            return badRequest("IMAGE_FRAGMENT_TOTAL_LIMIT");
        }

        await prisma.errorItem.update({ where: { id }, data: { imageFragments: result.serialized } });
        logger.info({ errorItemId: id, count: result.fragments.length }, "Manual figure image appended");
        return NextResponse.json({ imageFragments: result.serialized, image: result.fragments.at(-1) });
    } catch (error) {
        logger.error({ error }, "Error adding manual figure image");
        return internalError("Failed to save figure image");
    }
}

/** 删除一张手动配图，不影响原题原图或旧版 SVG 配图。 */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    try {
        const user = await getCurrentUser();
        if (!user) return unauthorized("Authentication required");

        const item = await findOwnedItem(id, user.id);
        if (!item) return notFound("Item not found");

        const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
        if (!parsed.success) return badRequest("INVALID_FRAGMENT_ID");

        const result = removeImageFragment(item.imageFragments, parsed.data.fragmentId);
        await prisma.errorItem.update({
            where: { id },
            data: { imageFragments: result.serialized || null },
        });
        logger.info({ errorItemId: id, count: result.fragments.length }, "Manual figure image removed");
        return NextResponse.json({ imageFragments: result.serialized || null });
    } catch (error) {
        logger.error({ error }, "Error removing manual figure image");
        return internalError("Failed to remove figure image");
    }
}
