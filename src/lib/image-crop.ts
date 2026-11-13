/** 以图片宽高为 1 的相对坐标表示的矩形区域 */
export interface ImageRegion {
    x: number;
    y: number;
    width: number;
    height: number;
}

export type ImageRotation = 0 | 90 | 180 | 270;

export function normalizeImageRotation(rotation: number): ImageRotation {
    const normalized = ((Math.round(rotation) % 360) + 360) % 360;
    return normalized === 90 || normalized === 180 || normalized === 270 ? normalized : 0;
}

/** 把旋转后预览图中的区域映射回未旋转原图的相对坐标。 */
export function mapRotatedRegionToSource(region: ImageRegion, rotation: ImageRotation): ImageRegion {
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    const clean = (value: number) => Number(value.toFixed(6));
    const x = clamp(region.x);
    const y = clamp(region.y);
    const width = Math.min(1 - x, Math.max(0, region.width));
    const height = Math.min(1 - y, Math.max(0, region.height));

    switch (rotation) {
        case 90:
            return { x: clean(y), y: clean(1 - x - width), width: clean(height), height: clean(width) };
        case 180:
            return { x: clean(1 - x - width), y: clean(1 - y - height), width: clean(width), height: clean(height) };
        case 270:
            return { x: clean(1 - y - height), y: clean(x), width: clean(height), height: clean(width) };
        default:
            return { x: clean(x), y: clean(y), width: clean(width), height: clean(height) };
    }
}

/** 生成裁剪器使用的旋转预览；只处理预览图，不影响原图数据。 */
export async function createRotatedImagePreview(src: string, rotation: ImageRotation): Promise<string> {
    if (rotation === 0) return src;
    const safeSrc = toSafeImageSrc(src);
    if (!safeSrc) throw new Error("UNSAFE_IMAGE_SOURCE");

    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("IMAGE_PREVIEW_DECODE_FAILED"));
        image.src = safeSrc;
    });

    const canvas = document.createElement("canvas");
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    const rotatedWidth = rotation === 90 || rotation === 270 ? height : width;
    const rotatedHeight = rotation === 90 || rotation === 270 ? width : height;
    canvas.width = rotatedWidth;
    canvas.height = rotatedHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("CANVAS_UNSUPPORTED");

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, rotatedWidth, rotatedHeight);
    context.translate(
        rotation === 90 ? rotatedWidth : rotation === 180 ? rotatedWidth : 0,
        rotation === 90 || rotation === 180 ? rotatedHeight : rotation === 270 ? rotatedHeight : 0,
    );
    context.rotate((rotation * Math.PI) / 180);
    context.drawImage(image, 0, 0, width, height);

    return new Promise<string>((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (!blob) {
                reject(new Error("CANVAS_EMPTY"));
                return;
            }
            resolve(URL.createObjectURL(blob));
        }, "image/jpeg", 0.9);
    });
}

/** 规范化拖拽得到的两个角点为矩形，并限制在图片范围内 */
/** 待裁剪图片只来自本地文件生成的 blob/data 地址，其他地址一律不渲染 */
export function toSafeImageSrc(src: string): string | undefined {
    return /^(blob:|data:image\/)/i.test(src) ? src : undefined;
}

export function regionFromPoints(ax: number, ay: number, bx: number, by: number): ImageRegion {
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    const x1 = clamp(Math.min(ax, bx));
    const y1 = clamp(Math.min(ay, by));
    const x2 = clamp(Math.max(ax, bx));
    const y2 = clamp(Math.max(ay, by));
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/** 按原图分辨率裁剪出各区域，返回 JPEG 图片 */
export async function cropImageRegions(image: HTMLImageElement, regions: ImageRegion[]): Promise<Blob[]> {
    const { naturalWidth, naturalHeight } = image;
    return Promise.all(regions.map((region) => new Promise<Blob>((resolve, reject) => {
        const canvas = document.createElement("canvas");
        const sx = Math.round(region.x * naturalWidth);
        const sy = Math.round(region.y * naturalHeight);
        canvas.width = Math.max(1, Math.round(region.width * naturalWidth));
        canvas.height = Math.max(1, Math.round(region.height * naturalHeight));
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            reject(new Error("Canvas is not supported"));
            return;
        }
        ctx.drawImage(image, sx, sy, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Canvas is empty"))), "image/jpeg", 0.95);
    })));
}
