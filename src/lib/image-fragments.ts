export interface ImageFragment {
    id: string;
    imageUrl: string;
    order: number;
}

const IMAGE_DATA_URL_RE = /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/i;
export const MAX_IMAGE_FRAGMENT_LENGTH = 20 * 1024 * 1024;
export const MAX_IMAGE_FRAGMENTS = 20;
export const MAX_IMAGE_FRAGMENTS_JSON_LENGTH = 40 * 1024 * 1024;

export function isImageFragmentDataUrl(value: unknown): value is string {
    return typeof value === "string"
        && value.length <= MAX_IMAGE_FRAGMENT_LENGTH
        && IMAGE_DATA_URL_RE.test(value);
}

export function parseImageFragments(value: string | null | undefined): ImageFragment[] {
    if (!value || value.length > MAX_IMAGE_FRAGMENTS_JSON_LENGTH) return [];

    try {
        const parsed: unknown = JSON.parse(value);
        if (!Array.isArray(parsed)) return [];

        return parsed
            .filter((entry): entry is Partial<ImageFragment> => typeof entry === "object" && entry !== null)
            .filter((entry) => typeof entry.id === "string" && isImageFragmentDataUrl(entry.imageUrl))
            .map((entry, index) => ({
                id: entry.id!,
                imageUrl: entry.imageUrl!,
                order: Number.isInteger(entry.order) ? entry.order! : index,
            }))
            .sort((left, right) => left.order - right.order)
            .slice(0, MAX_IMAGE_FRAGMENTS);
    } catch {
        return [];
    }
}

export function serializeImageFragments(fragments: ImageFragment[]): string {
    return JSON.stringify(fragments.map((fragment, index) => ({
        id: fragment.id,
        imageUrl: fragment.imageUrl,
        order: index,
    })));
}

export function appendImageFragment(value: string | null | undefined, imageUrl: string): { fragments: ImageFragment[]; serialized: string } {
    const fragments = parseImageFragments(value);
    if (fragments.length >= MAX_IMAGE_FRAGMENTS) throw new Error("IMAGE_FRAGMENT_LIMIT");

    const next: ImageFragment = {
        id: crypto.randomUUID(),
        imageUrl,
        order: fragments.length,
    };
    const nextFragments = [...fragments, next];
    const serialized = serializeImageFragments(nextFragments);
    if (serialized.length > MAX_IMAGE_FRAGMENTS_JSON_LENGTH) throw new Error("IMAGE_FRAGMENT_TOTAL_LIMIT");
    return { fragments: nextFragments, serialized };
}

export function removeImageFragment(value: string | null | undefined, fragmentId: string): { fragments: ImageFragment[]; serialized: string } {
    const fragments = parseImageFragments(value).filter((fragment) => fragment.id !== fragmentId);
    return { fragments, serialized: fragments.length > 0 ? serializeImageFragments(fragments) : "" };
}
