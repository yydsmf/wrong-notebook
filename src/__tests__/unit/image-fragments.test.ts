import { describe, expect, it } from "vitest";
import {
    appendImageFragment,
    isImageFragmentDataUrl,
    parseImageFragments,
    removeImageFragment,
} from "@/lib/image-fragments";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

describe("image fragments", () => {
    it("validates and appends multiple images in order", () => {
        expect(isImageFragmentDataUrl(PNG)).toBe(true);
        expect(isImageFragmentDataUrl("data:text/html;base64,abc")).toBe(false);

        const first = appendImageFragment(null, PNG);
        const second = appendImageFragment(first.serialized, PNG);
        const fragments = parseImageFragments(second.serialized);

        expect(fragments).toHaveLength(2);
        expect(fragments[0].order).toBe(0);
        expect(fragments[1].order).toBe(1);
        expect(fragments[0].id).not.toBe(fragments[1].id);
    });

    it("removes one image and renumbers the remaining list", () => {
        const first = appendImageFragment(null, PNG);
        const second = appendImageFragment(first.serialized, PNG);
        const id = parseImageFragments(second.serialized)[0].id;
        const result = removeImageFragment(second.serialized, id);

        expect(parseImageFragments(result.serialized)).toEqual([
            { id: parseImageFragments(second.serialized)[1].id, imageUrl: PNG, order: 0 },
        ]);
    });

    it("ignores malformed or unsafe persisted values", () => {
        expect(parseImageFragments("not-json")).toEqual([]);
        expect(parseImageFragments(JSON.stringify([{ id: "x", imageUrl: "javascript:alert(1)", order: 0 }]))).toEqual([]);
    });
});
