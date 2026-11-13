import { frontendLogger } from "@/lib/frontend-logger";
import { describeImage, processImageBlob } from "@/lib/image-pipeline";

/** Process a complete image using the original project's image pipeline. */
export async function processImageFile(file: Blob): Promise<string> {
    const { prepared, rendered } = await processImageBlob(file);
    frontendLogger.info("[ImageCompress]", "Image processed", {
        ...describeImage(prepared, rendered),
        ...prepared.timings,
        ...rendered.timings,
    });
    return rendered.dataUrl;
}
