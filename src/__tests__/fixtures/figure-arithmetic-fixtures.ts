import type { FigureSpecFixture } from './figure-spec-fixtures';

export const ARITHMETIC_FIGURE_FIXTURES: Array<FigureSpecFixture & { initialVisible?: boolean }> = [
    {
        id: 'multiplication-answer-blanks', stage: '小学', type: 'vertical_arithmetic', initialVisible: true,
        spec: {
            type: 'vertical_arithmetic', operation: '×', top: '34', bottom: '25',
            partialProducts: [{ value: '1□0', label: '甲' }, { value: '□□', label: '乙' }], result: '□□□',
        },
        mustContain: ['>34</text>', '>25</text>', '>1□0</text>', '>□□</text>', '>□□□</text>', '>甲</text>', '>乙</text>'],
    },
    {
        id: 'multiplication-unknown-top', stage: '小学', type: 'vertical_arithmetic', initialVisible: true,
        spec: {
            type: 'vertical_arithmetic', operation: '×', top: '□□', bottom: '25',
            partialProducts: [{ value: '□□□', label: '甲' }, { value: '□□', label: '乙' }],
        },
        mustContain: ['>□□</text>', '>25</text>', '>□□□</text>', '>甲</text>', '>乙</text>'],
    },
    {
        id: 'multiplication-skipped-zero-position', stage: '小学', type: 'vertical_arithmetic', initialVisible: true,
        spec: {
            type: 'vertical_arithmetic', operation: '×', top: '34', bottom: '205',
            partialProducts: [{ value: '170', shift: 0 }, { value: '68', shift: 2 }], result: '6970',
        },
        mustContain: ['>34</text>', '>205</text>', '>170</text>', '>68</text>', '>6970</text>'],
    },
    {
        id: 'multiplication-wrapped-note', stage: '小学', type: 'vertical_arithmetic', initialVisible: true,
        spec: {
            type: 'vertical_arithmetic', operation: '×', top: '34', bottom: '25',
            partialProducts: [{ value: '1□0', label: '甲' }, { value: '□□', label: '乙' }], result: '□□□',
            note: '每一行部分积都对应一个数位，请比较数位关系再填写方框',
        },
        mustContain: ['>1□0</text>', '>□□</text>', '>□□□</text>'],
        mustHaveText: ['每一行部分积都对应一个数位,请比较数位关系再填写方框'],
    },
    {
        id: 'multiplication-eight-rows-note', stage: '小学', type: 'vertical_arithmetic',
        spec: {
            type: 'vertical_arithmetic', operation: '×', top: '12345678', bottom: '87654321',
            partialProducts: Array.from({ length: 8 }, (_, shift) => ({ value: '1', label: `积${shift + 1}`, shift })),
            result: '1', note: '比较每一行部分积并说明数位关系',
        },
        mustContain: ['>12345678</text>', '>87654321</text>', '>1082152022374638</text>', '>积1</text>', '>积8</text>', '>比较每一行部分积并说明数位关系</text>'],
    },
];
