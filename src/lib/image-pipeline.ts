/**
 * Browser-side question image pipeline.
 *
 * Images are decoded with EXIF orientation applied, previewed at a smaller
 * size, then rendered once from the decoded source. Quality is kept above a
 * floor; when the encoded image is still too large, dimensions are reduced
 * instead of destroying JPEG quality.
 */
import { mapRotatedRegionToSource } from "@/lib/image-crop";
import type { ImageRegion, ImageRotation } from "@/lib/image-crop";

export interface ImageOutputLimits {
    maxLongEdge: number;
    maxPixels: number;
    maxBytes: number;
    startQuality: number;
    minQuality: number;
}

export const DEFAULT_IMAGE_LIMITS: ImageOutputLimits = {
    maxLongEdge: 4096,
    maxPixels: 2560 * 1920,
    maxBytes: 1.5 * 1024 * 1024,
    startQuality: 0.9,
    minQuality: 0.8,
};

export const PREVIEW_LONG_EDGE = 1600;
const SHRINK_STEP = 0.85;
const QUALITY_STEP = 0.05;

export type ImageFormat = "jpeg" | "png" | "webp" | "gif" | "bmp" | "heic" | "avif" | "unknown";
export type ImageDecodeErrorCode = "HEIC_DECODE_FAILED" | "IMAGE_DECODE_FAILED" | "UNSUPPORTED_IMAGE";

export class ImageDecodeError extends Error {
    constructor(readonly code: ImageDecodeErrorCode, readonly format: ImageFormat, cause?: unknown) {
        super(code, cause === undefined ? undefined : { cause });
        this.name = "ImageDecodeError";
    }
}

const HEVC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "hevm", "hevs"]);
const GENERIC_HEIF_BRANDS = new Set(["mif1", "msf1", "mif2"]);
const AVIF_BRANDS = new Set(["avif", "avis"]);

/** Detect the actual format from the file header instead of the filename. */
export function sniffImageFormat(bytes: Uint8Array): ImageFormat {
    const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
    if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "png";
    if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "webp";
    if (bytes.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) return "gif";
    if (bytes.length >= 2 && ascii(0, 2) === "BM") return "bmp";
    if (bytes.length >= 12 && ascii(4, 8) === "ftyp") {
        const declaredSize = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
        const size = Math.min(bytes.length, declaredSize || bytes.length);
        const brands = [ascii(8, 12)];
        for (let offset = 16; offset + 4 <= size; offset += 4) brands.push(ascii(offset, offset + 4));
        if (brands.some((brand) => HEVC_BRANDS.has(brand))) return "heic";
        if (brands.some((brand) => AVIF_BRANDS.has(brand))) return "avif";
        if (brands.some((brand) => GENERIC_HEIF_BRANDS.has(brand))) return "heic";
    }
    return "unknown";
}

export function computeOutputSize(
    width: number,
    height: number,
    limits: Pick<ImageOutputLimits, "maxLongEdge" | "maxPixels"> = DEFAULT_IMAGE_LIMITS,
) {
    const scale = Math.min(
        1,
        limits.maxLongEdge / Math.max(width, height),
        Math.sqrt(limits.maxPixels / Math.max(1, width * height)),
    );
    return {
        width: Math.max(1, Math.floor(width * scale)),
        height: Math.max(1, Math.floor(height * scale)),
        scale,
    };
}

type DecodedSource = ImageBitmap | HTMLImageElement;

export interface PreparedImage {
    source: DecodedSource;
    width: number;
    height: number;
    format: ImageFormat;
    decoder: "native" | "heic";
    previewUrl: string;
    sourceType: string;
    sourceBytes: number;
    timings: { read: number; convert: number };
    dispose: () => void;
}

export interface RenderedImage {
    dataUrl: string;
    width: number;
    height: number;
    bytes: number;
    quality: number;
    rotation: ImageRotation;
    timings: { crop: number; compress: number };
}

function loadImageElement(blob: Blob): Promise<HTMLImageElement> {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.decoding = "async";
    return new Promise<HTMLImageElement>((resolve, reject) => {
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("IMAGE_ELEMENT_DECODE_FAILED"));
        image.src = url;
    }).finally(() => URL.revokeObjectURL(url));
}

async function decodeNative(blob: Blob): Promise<DecodedSource> {
    if (typeof createImageBitmap === "function") {
        try {
            return await createImageBitmap(blob, { imageOrientation: "from-image" });
        } catch {
            // Fall back to an image element for browsers without this option.
        }
    }
    const image = await loadImageElement(blob);
    if (!image.naturalWidth || !image.naturalHeight) throw new Error("IMAGE_EMPTY");
    return image;
}

function sourceSize(source: DecodedSource) {
    return source instanceof HTMLImageElement
        ? { width: source.naturalWidth, height: source.naturalHeight }
        : { width: source.width, height: source.height };
}

async function convertHeic(blob: Blob): Promise<Blob> {
    const { heicTo } = await import("heic-to/csp");
    return heicTo({ blob, type: "image/jpeg", quality: 0.95 });
}

function createCanvas(width: number, height: number) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("CANVAS_EMPTY"))), "image/jpeg", quality);
    });
}

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error ?? new Error("READ_FAILED"));
        reader.readAsDataURL(blob);
    });
}

function drawRegion(source: DecodedSource, sx: number, sy: number, sw: number, sh: number, width: number, height: number, rotation: ImageRotation = 0) {
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("CANVAS_UNSUPPORTED");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    if (rotation === 90) {
        context.translate(width, 0);
        context.rotate(Math.PI / 2);
        context.drawImage(source, sx, sy, sw, sh, 0, 0, height, width);
    } else if (rotation === 180) {
        context.translate(width, height);
        context.rotate(Math.PI);
        context.drawImage(source, sx, sy, sw, sh, 0, 0, width, height);
    } else if (rotation === 270) {
        context.translate(0, height);
        context.rotate(-Math.PI / 2);
        context.drawImage(source, sx, sy, sw, sh, 0, 0, height, width);
    } else {
        context.drawImage(source, sx, sy, sw, sh, 0, 0, width, height);
    }
    return canvas;
}

export async function prepareImage(file: Blob, onConverting?: () => void): Promise<PreparedImage> {
    const readStarted = performance.now();
    const buffer = await file.arrayBuffer();
    const read = performance.now() - readStarted;
    const format = sniffImageFormat(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 64)));
    const sourceType = file.type || "";
    const convertStarted = performance.now();
    const blob = new Blob([buffer], { type: sourceType || "application/octet-stream" });
    let source: DecodedSource;
    let decoder: PreparedImage["decoder"] = "native";

    try {
        source = await decodeNative(blob);
    } catch (nativeError) {
        if (format !== "heic") {
            throw new ImageDecodeError(format === "unknown" ? "UNSUPPORTED_IMAGE" : "IMAGE_DECODE_FAILED", format, nativeError);
        }
        onConverting?.();
        try {
            source = await decodeNative(await convertHeic(blob));
            decoder = "heic";
        } catch (heicError) {
            throw new ImageDecodeError("HEIC_DECODE_FAILED", format, heicError);
        }
    }

    const { width, height } = sourceSize(source);
    if (!width || !height) throw new ImageDecodeError("IMAGE_DECODE_FAILED", format);
    const preview = computeOutputSize(width, height, { maxLongEdge: PREVIEW_LONG_EDGE, maxPixels: Number.POSITIVE_INFINITY });
    const previewBlob = await canvasToBlob(drawRegion(source, 0, 0, width, height, preview.width, preview.height), 0.85);
    const previewUrl = URL.createObjectURL(previewBlob);

    return {
        source,
        width,
        height,
        format,
        decoder,
        previewUrl,
        sourceType,
        sourceBytes: file.size,
        timings: { read: Math.round(read), convert: Math.round(performance.now() - convertStarted) },
        dispose: () => {
            URL.revokeObjectURL(previewUrl);
            if (!(source instanceof HTMLImageElement)) source.close();
        },
    };
}

const FULL_IMAGE: ImageRegion = { x: 0, y: 0, width: 1, height: 1 };

export async function renderRegion(
    prepared: Pick<PreparedImage, "source" | "width" | "height">,
    region: ImageRegion = FULL_IMAGE,
    rotationOrLimits: ImageRotation | ImageOutputLimits = 0,
    limits: ImageOutputLimits = DEFAULT_IMAGE_LIMITS,
): Promise<RenderedImage> {
    const rotation: ImageRotation = typeof rotationOrLimits === "number" ? rotationOrLimits : 0;
    const outputLimits = typeof rotationOrLimits === "number" ? limits : rotationOrLimits;
    const cropStarted = performance.now();
    const sourceRegion = mapRotatedRegionToSource(region, rotation);
    const sx = Math.round(sourceRegion.x * prepared.width);
    const sy = Math.round(sourceRegion.y * prepared.height);
    const sw = Math.max(1, Math.min(prepared.width - sx, Math.round(sourceRegion.width * prepared.width)));
    const sh = Math.max(1, Math.min(prepared.height - sy, Math.round(sourceRegion.height * prepared.height)));
    const outputWidth = rotation === 90 || rotation === 270 ? sh : sw;
    const outputHeight = rotation === 90 || rotation === 270 ? sw : sh;
    let size = computeOutputSize(outputWidth, outputHeight, outputLimits);
    let canvas = drawRegion(prepared.source, sx, sy, sw, sh, size.width, size.height, rotation);
    const crop = performance.now() - cropStarted;

    const compressStarted = performance.now();
    let quality = outputLimits.startQuality;
    let blob = await canvasToBlob(canvas, quality);
    for (let attempt = 0; blob.size > outputLimits.maxBytes && attempt < 12; attempt += 1) {
        if (quality - QUALITY_STEP >= outputLimits.minQuality - 1e-9) {
            quality = Math.round((quality - QUALITY_STEP) * 100) / 100;
        } else {
            size = {
                width: Math.max(1, Math.floor(size.width * SHRINK_STEP)),
                height: Math.max(1, Math.floor(size.height * SHRINK_STEP)),
                scale: size.scale * SHRINK_STEP,
            };
            canvas = drawRegion(prepared.source, sx, sy, sw, sh, size.width, size.height, rotation);
        }
        blob = await canvasToBlob(canvas, quality);
    }

    return {
        dataUrl: await blobToDataUrl(blob),
        width: size.width,
        height: size.height,
        bytes: blob.size,
        quality,
        rotation,
        timings: { crop: Math.round(crop), compress: Math.round(performance.now() - compressStarted) },
    };
}

export function describeImage(prepared: PreparedImage, rendered: RenderedImage) {
    return {
        sourceType: prepared.sourceType || prepared.format,
        sourceBytes: prepared.sourceBytes,
        sourceWidth: prepared.width,
        sourceHeight: prepared.height,
        outputWidth: rendered.width,
        outputHeight: rendered.height,
        outputBytes: rendered.bytes,
        decoder: prepared.decoder,
        quality: rendered.quality,
        rotation: rendered.rotation,
    };
}

export async function processImageBlob(file: Blob, limits: ImageOutputLimits = DEFAULT_IMAGE_LIMITS) {
    const prepared = await prepareImage(file);
    try {
        return { prepared, rendered: await renderRegion(prepared, FULL_IMAGE, 0, limits) };
    } finally {
        prepared.dispose();
    }
}
