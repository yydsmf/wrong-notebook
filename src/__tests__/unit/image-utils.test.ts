import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    processImageBlob: vi.fn(async () => ({
    prepared: {
        sourceType: "image/jpeg",
        sourceBytes: 4 * 1024 * 1024,
        width: 4032,
        height: 3024,
        decoder: "native",
        timings: { read: 3, convert: 8 },
    },
    rendered: {
        dataUrl: "data:image/jpeg;base64,processed",
        width: 2560,
        height: 1920,
        bytes: 1.2 * 1024 * 1024,
        quality: 0.8,
        timings: { crop: 2, compress: 5 },
    },
    })),
    describeImage: vi.fn((prepared: { sourceType: string; sourceBytes: number; width: number; height: number }, rendered: { width: number; height: number; bytes: number; quality: number }) => ({
    sourceType: prepared.sourceType,
    sourceBytes: prepared.sourceBytes,
    sourceWidth: prepared.width,
    sourceHeight: prepared.height,
    outputWidth: rendered.width,
    outputHeight: rendered.height,
    outputBytes: rendered.bytes,
    decoder: rendered.quality >= 0.8 ? "native" : "unknown",
    quality: rendered.quality,
    })),
}));

vi.mock("@/lib/image-pipeline", () => mocks);
vi.mock("@/lib/frontend-logger", () => ({ frontendLogger: { info: vi.fn() } }));

import { processImageFile } from "@/lib/image-utils";

describe("processImageFile", () => {
    it("uses the image pipeline and returns its encoded data URL", async () => {
        const file = new File([new Uint8Array([1, 2, 3])], "question.jpg", { type: "image/jpeg" });

        await expect(processImageFile(file)).resolves.toBe("data:image/jpeg;base64,processed");
        expect(mocks.processImageBlob).toHaveBeenCalledWith(file);
        expect(mocks.describeImage).toHaveBeenCalled();
    });
});
