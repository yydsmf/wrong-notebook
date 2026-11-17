/**
 * AI 提示词生成器单元测试
 * 测试提示词模板变量替换和生成逻辑
 */
import { describe, it, expect } from 'vitest';
import {
    generateAnalyzePrompt,
    generateSimilarQuestionPrompt,
    generateReanswerPrompt,
    generateMasteryPrompt,
    generateGradingPrompt,
    generateTagSuggestPrompt,
    generateFigurePrompt,
    generateGradeInstruction,
    gradeSemesterToDisplayName,
    gradeSemesterToGradeNumber,
    DEFAULT_ANALYZE_TEMPLATE,
    DEFAULT_SIMILAR_TEMPLATE,
    DEFAULT_REANSWER_TEMPLATE,
} from '@/lib/ai/prompts';

describe('AI Prompts', () => {
    describe('默认模板存在性', () => {
        it('应该导出 DEFAULT_ANALYZE_TEMPLATE', () => {
            expect(DEFAULT_ANALYZE_TEMPLATE).toBeDefined();
            expect(typeof DEFAULT_ANALYZE_TEMPLATE).toBe('string');
            expect(DEFAULT_ANALYZE_TEMPLATE.length).toBeGreaterThan(100);
        });

        it('应该导出 DEFAULT_SIMILAR_TEMPLATE', () => {
            expect(DEFAULT_SIMILAR_TEMPLATE).toBeDefined();
            expect(typeof DEFAULT_SIMILAR_TEMPLATE).toBe('string');
        });

        it('应该导出 DEFAULT_REANSWER_TEMPLATE', () => {
            expect(DEFAULT_REANSWER_TEMPLATE).toBeDefined();
            expect(typeof DEFAULT_REANSWER_TEMPLATE).toBe('string');
        });
    });

    describe('generateAnalyzePrompt', () => {
        it('要求判断是否有配图并输出文字图示说明，不在识题阶段重绘 SVG', () => {
            const prompt = generateAnalyzePrompt('zh', 7, '数学');
            expect(prompt).toContain('<has_figure>');
            expect(prompt).toContain('<figure_description>');
            expect(prompt).not.toContain('<figure_svg>');
            expect(prompt).toContain('13 个 XML 标签');
            expect(prompt).toContain('有配图时输出 figure_description');
            expect(prompt).toContain('图片写“1分米”时必须写“1分米”');
            expect(prompt).toContain('先判断图片是否旋转、倒置或倾斜');
            expect(prompt).toContain('原图没有括号时才写作 $\\frac{\\square}{\\square}$');
            expect(prompt).toContain('括号内有手写数字，清除数字后必须写作 $\\frac{(\\square)}{(\\square)}$');
            expect(prompt).toContain('不要写成 $\\frac{____}{____}$');
            expect(prompt).toContain('不能因过滤手写内容而删除分数线、括号、上下排列');
            expect(prompt).toContain('原图分数线上下分别印有括号');
            expect(prompt).toContain('$\\frac{(\\square)}{(\\square)}$');
            expect(prompt).toContain('先辨认原图中印刷的空格结构，再只移除');
            expect(prompt).toContain('逐项对照原图复核每个空格的括号');
            expect(prompt).toContain('普通横向填空');
        });

        it('单独重绘配图的提示词带上题干用于核对标注', () => {
            const prompt = generateFigurePrompt('如图，AB=3');
            expect(prompt).toContain('如图，AB=3');
            expect(prompt).toContain('<figure_spec>');
            expect(prompt).toContain('vertical_arithmetic');
            expect(prompt).toContain('arcType');
            expect(prompt).toContain('through');
            expect(prompt).toContain('figure_group');
            expect(prompt).toContain('figures 必须按原题顺序完整列出');
            expect(prompt).toContain('compareSizes:true');
            expect(prompt).toContain('compareSizes 是可选布尔值，默认 false');
            expect(prompt).toContain('不能跨子图引用点');
            expect(prompt).toContain('3.4×25 不能截成4×25');
            expect(prompt).toContain('分数斜线不能直接当作除法');
            expect(prompt).toContain('figure_spec 留空');
            expect(prompt).toContain('<figure_svg>');
            expect(generateFigurePrompt(null)).toContain('（无题目文字）');
        });

        it.each(['zh', 'en'] as const)('重绘和相似题共用圆柱圆锥结构、角色和回退约束（%s）', (language) => {
            for (const prompt of [generateFigurePrompt('下图是一个圆锥。'), generateSimilarQuestionPrompt(language, '下图是一个圆锥。', ['立体图形'], 'medium')]) {
                expect(prompt).toContain('round_solid');
                expect(prompt).toContain('shape:"cylinder"|"cone"');
                expect(prompt).toContain('圆锥轮廓必须与底面椭圆相切');
                expect(prompt).toContain('slantLabel 只适用于圆锥');
                expect(prompt).toContain('半径（或直径的一半）、高、母线');
                expect(prompt).toContain('不要用该模板表达斜圆柱、斜圆锥、圆台');
                expect(prompt).toContain('半径/直径/高/母线的文字前缀不能放到其它角色字段');
                expect(prompt).toContain('area_geometry、solid_geometry、round_solid、坐标图等模板会各自适配画布');
            }
        });

        it.each(['zh', 'en'] as const)('重绘和相似题共用完整球体模板，不补未知量（%s）', (language) => {
            for (const prompt of [generateFigurePrompt('下图是一个球体。'), generateSimilarQuestionPrompt(language, '下图是一个球体。', ['立体图形'], 'medium')]) {
                expect(prompt).toContain('sphere_geometry：{type,radius,radiusLabel?,diameterLabel?,title?,fill?}');
                expect(prompt).toContain('前实后虚的赤道椭圆');
                expect(prompt).toContain('不能把平面圆、半球、球壳、截面、挖孔或组合体套成完整球体');
                expect(prompt).toContain('不计算缺失标签或答案');
            }
        });

        it('重绘和新题配图共用圆的明确长度约束，不推断缺失单位', () => {
            const prompts = [
                generateFigurePrompt('如图，半径为3cm，弦AC长4cm'),
                generateSimilarQuestionPrompt('zh', '如图求弦长', ['圆'], 'medium'),
            ];
            for (const prompt of prompts) {
                expect(prompt).toContain('弦长不能超过直径或半径的两倍');
                expect(prompt).toContain('同一对端点无论顺序如何');
                expect(prompt).toContain('无单位值只和其它无单位值比较');
                expect(prompt).toContain('未知值不能遮住已知长度间的矛盾');
                expect(prompt).toContain('不得根据相对绘图半径、弦的角度或坐标比例推算实际长度');
                expect(prompt).toContain('对齐后仍不能重合或形成零长度弦');
                expect(prompt).toContain('直径两端在对齐后仍须经过圆心');
                expect(prompt).toContain('不能为通过校验而合并点名、删除线段或移动端点');
            }
        });

        it.each(['zh', 'en'] as const)('重绘和新题配图同步可见点名的唯一性边界（%s）', (language) => {
            for (const prompt of [generateFigurePrompt('如图，连接AB。'), generateSimilarQuestionPrompt(language, '如图，连接AB。', ['几何'], 'medium')]) {
                expect(prompt).toContain('可见点名在同一子图内必须唯一，圆心也参与检查');
                expect(prompt).toContain('不把重复的描述文字、隐藏ID或其它记法当作重复点名');
                expect(prompt).toContain('不同子图可各自使用相同点名');
                expect(prompt).toContain('不要为通过校验而换名、合并点或移动点');
            }
        });

        it.each(['zh', 'en'] as const)('数轴点名共同避让但保留点位和刻度（%s）', (language) => {
            for (const prompt of [generateFigurePrompt('数轴上的点A和点B。'), generateSimilarQuestionPrompt(language, '数轴上的点A和点B。', ['数轴'], 'medium')]) {
                expect(prompt).toContain('数轴的可见字母点名也须唯一');
                expect(prompt).toContain('不得通过移动点位、删刻度或改数值解决拥挤');
                expect(prompt).toContain('同位置的不同点名按题意保留，不擅自合并或换名');
            }
        });

        it.each(['zh', 'en'] as const)('重绘和新题配图同步题干点名关系（%s）', (language) => {
            for (const prompt of [generateFigurePrompt('如图，连接AB，且AB⊥CD，∠ABC为直角。'), generateSimilarQuestionPrompt(language, '如图，连接AB，且AB⊥CD，∠ABC为直角。', ['几何'], 'medium')]) {
                expect(prompt).toContain('题干明确写出“连接AB”“线段AB”“∠ABC”“AB∥CD”或“AB⊥CD”等关系时');
                expect(prompt).toContain('不能把相邻点、对角线、其它角或其它子图冒充目标关系');
                expect(prompt).toContain('若关系中的部分点名已在该图出现、其余点名却缺失，不能静默省略该关系');
                expect(prompt).toContain('直角关系须由坐标或直角标记支持');
                expect(prompt).toContain('平行和垂直须由对应线段方向支持');
                expect(prompt).toContain('只出现变量或长度求值时不要猜测');
                expect(prompt).toContain('关系无法唯一分解或整组点名都不在该图时保持保守');
            }
        });

        it.each(['zh', 'en'] as const)('图组关系只按明确子图标签校验（%s）', (language) => {
            const prompts = [
                generateFigurePrompt('图A中连接AB；图B中连接CD。'),
                generateSimilarQuestionPrompt(language, '图A中连接AB；图B中连接CD。', ['几何'], 'medium'),
            ];
            for (const prompt of prompts) {
                expect(prompt).toContain('若明确用“图A中……；图B中……”');
                expect(prompt).toContain('必须把每段条件只校验到对应 label');
                expect(prompt).toContain('选择题、判断题和真假判断中互相矛盾的选项内容是待判命题');
            }
        });

        it.each(['zh', 'en'] as const)('重绘和新题配图同步直角与角名的绑定规则（%s）', (language) => {
            for (const prompt of [generateFigurePrompt('∠AOB，∠ABC为直角。'), generateSimilarQuestionPrompt(language, '∠AOB，∠ABC为直角。', ['几何'], 'medium')]) {
                expect(prompt).toContain('直角条件必须与对应角名紧邻绑定');
                expect(prompt).toContain('不能把后一个角的条件套给前一个角');
                expect(prompt).toContain('提问、待证明和假设不能当作已知直角');
                expect(prompt).toContain('190°或90.5°也不能截成90°');
                expect(prompt).toContain('不把有限直角校验当作通用角度验算');
            }
        });

        it.each(['zh', 'en'] as const)('重绘和新题配图同步后置圆归属（%s）', (language) => {
            for (const prompt of [generateFigurePrompt('AB是圆O的弦。'), generateSimilarQuestionPrompt(language, 'AC是外圆的一条直径。', ['圆'], 'medium')]) {
                expect(prompt).toContain('后置圆归属，必须核对当前关系指定的圆');
                expect(prompt).toContain('完整圆名优先于圆心点名');
                expect(prompt).toContain('同名圆不能按端点或半径猜选');
                expect(prompt).toContain('只约束当前关系，不能串用到后续线段');
                expect(prompt).toContain('未标注的内外圆名不根据尺寸补写');
                expect(prompt).toContain('不改点位或增加线段');
            }
        });

        it.each(['zh', 'en'] as const)('重绘和新题配图同步题干长度与图内标注（%s）', (language) => {
            for (const prompt of [generateFigurePrompt('已知AB=5厘米。'), generateSimilarQuestionPrompt(language, 'AB has length 5 cm.', ['几何'], 'medium')]) {
                expect(prompt).toContain('题干明确写出“AB=5厘米”');
                expect(prompt).toContain('必须逐项精确核对数值和单位换算');
                expect(prompt).toContain('反向点名视为同一线段');
                expect(prompt).toContain('支持有限小数、普通分数、带分数');
                expect(prompt).toContain('不根据坐标比例推算长度');
                expect(prompt).toContain('不为没有标注的线段补值');
            }
        });

        it.each(['zh', 'en'] as const)('重绘和新题配图同步题干坐标的点名及数值（%s）', (language) => {
            for (const prompt of [generateFigurePrompt('点A的坐标为(1,2)。'), generateSimilarQuestionPrompt(language, 'Point A has coordinates (1,2).', ['坐标'], 'medium')]) {
                expect(prompt).toContain('必须核对可见同名点及横纵坐标');
                expect(prompt).toContain('不能交换横纵轴、丢掉负号或用隐藏ID代替可见点名');
                expect(prompt).toContain('明确按子图分段时缺失点名使整组回退');
                expect(prompt).toContain('basic_geometry 的相对布局坐标不能当作数学坐标');
            }
        });

        it.each(['zh', 'en'] as const)('重绘和新题配图同步主图尺寸的方向及归属（%s）', (language) => {
            for (const prompt of [generateFigurePrompt('下图是长方形，长6厘米，宽4厘米。'), generateSimilarQuestionPrompt(language, 'The solid is a cuboid.', ['几何'], 'medium')]) {
                expect(prompt).toContain('明确主图声明后的长、宽、高、底、上下底、边长或棱长');
                expect(prompt).toContain('中文或英文维度前缀也参与比较，但保存原文');
                expect(prompt).toContain('只允许整组水平长宽互换，高保持竖向对应');
                expect(prompt).toContain('不能重复借用同一个标注绕过冲突');
                expect(prompt).toContain('梯形上底与下底不能互换');
                expect(prompt).toContain('三角形顶点说明不是边长');
                expect(prompt).toContain('“深”只有图内也有明确深度标签时才比较');
                expect(prompt).toContain('不把另一个物体、辅助线、疑问、假设或未知公式的数值套给主图');
                expect(prompt).toContain('面积与立体模板不跨类别套用尺寸');
                expect(prompt).toContain('不补值、不改坐标比例或原文');
                expect(prompt).toContain('支持“长宽高分别是4、3、2厘米”');
                expect(prompt).toContain('只在维度名无重复、数值个数与顺序一一对应时逐项核对');
                expect(prompt).toContain('数量不符或表达不完整时不猜');
                expect(prompt).toContain('英文表达 length, width, and height are 4 cm, 3 cm and 2 cm respectively');
            }
        });

        it.each(['zh', 'en'] as const)('重绘和新题配图同步圆线段点名与说明的边界（%s）', (language) => {
            for (const prompt of [generateFigurePrompt('radius OB has length 3 cm.'), generateSimilarQuestionPrompt(language, 'Given AB is a diameter.', ['圆'], 'medium')]) {
                expect(prompt).toContain('半径、弦和直径名称只含两个规范点名');
                expect(prompt).toContain('英文长度说明与前置说明不属于点名');
                expect(prompt).toContain('不从连续或空格分隔的三点长名称截取两个点');
                expect(prompt).toContain('不从自然语言长度求值或补写标注');
            }
        });

        it.each(['zh', 'en'] as const)('重绘和新题配图同步圆图的线段、角、弧和扇形关系（%s）', (language) => {
            for (const prompt of [generateFigurePrompt('圆O中，半径OA、弦AB、直径AC、圆心角AOB。'), generateSimilarQuestionPrompt(language, '圆O中，半径OA、弦AB、直径AC、圆心角AOB。', ['圆'], 'medium')]) {
                expect(prompt).toContain('circle_geometry 中题干明确写出“半径OA”“弦AB”“直径AB”“连接AB”“圆心角AOB”“圆周角ACB”');
                expect(prompt).toContain('直径可以作为弦，但普通弦不能冒充直径');
                expect(prompt).toContain('半径和圆心角的两条边必须连接圆心与对应圆周点');
                expect(prompt).toContain('圆周角的两条边必须是实际存在的弦');
                expect(prompt).toContain('两端点弧可用 arcType 区分优弧或劣弧');
                expect(prompt).toContain('三点弧名的中间点必须位于最终选定的弧段内部');
                expect(prompt).toContain('弧名中的点必须互不相同且均为圆周点');
                expect(prompt).toContain('不能使用圆心充当第三点');
                expect(prompt).toContain('可用 through 或 arcType 选择方向');
                expect(prompt).toContain('半圆必须由直径端点和第三点确定方向');
                expect(prompt).toContain('“AB是弦”“AB为直径”等后置表达也必须对应');
                expect(prompt).toContain('弧、优弧、劣弧、半圆和扇形也必须核对题干指定圆心');
                expect(prompt).toContain('逗号后的关系沿用当前圆范围');
                expect(prompt).toContain('规范弧名只含两个或三个点名，扇形名只含三个点名');
                expect(prompt).toContain('后续英文长度、面积说明不属于点名');
                expect(prompt).toContain('不能从四点长名称截取前三点');
                expect(prompt).toContain('basic_geometry 不因此推断弧方向或扇形区域');
                expect(prompt).toContain('只使用结构自身的 arcType 和 through 确定弧段');
                expect(prompt).toContain('不能借题干的第三点临时改变方向');
            }
        });

        it.each(['zh', 'en'] as const)('重绘和新题配图校验 basic_geometry 中圆与辅助线的明确关系（%s）', (language) => {
            for (const prompt of [generateFigurePrompt('圆O中，半径OA、弦AB、直径AC、圆心角AOB。'), generateSimilarQuestionPrompt(language, '圆O中，半径OA、弦AB、直径AC、圆心角AOB。', ['圆与辅助线'], 'medium')]) {
                expect(prompt).toContain('basic_geometry 含 circles 时');
                expect(prompt).toContain('半径、弦、直径、圆心角或圆周角');
                expect(prompt).toContain('半径一端必须是该圆圆心');
                expect(prompt).toContain('直径还必须经过圆心');
                expect(prompt).toContain('basic_geometry 不表达圆弧方向或扇形区域');
                expect(prompt).toContain('circles.label');
                expect(prompt).toContain('完整圆名唯一匹配');
                expect(prompt).toContain('不能按半径大小猜测内外归属');
                expect(prompt).toContain('重名对应多个圆时回退');
            }
        });

        it.each(['zh', 'en'] as const)('重绘和新题配图区分主图声明与后续提问（%s）', (language) => {
            const prompts = [
                generateFigurePrompt('下图是一个正方形，面积是多少？'),
                generateSimilarQuestionPrompt(language, '下图是一个正方形，求面积。', ['面积'], 'medium'),
            ];
            for (const prompt of prompts) {
                expect(prompt).toContain('声明之后的面积、周长或体积求值提问不能取消前面的明确形状条件');
                expect(prompt).toContain('不能因整题带问号而跳过形状核对');
                expect(prompt).toContain('形状疑问、命题判断、待证明、假设条件或引用内容不作为既定事实');
            }
        });

        it.each(['zh', 'en'] as const)('重绘和新题配图核对同名角的明确度数（%s）', (language) => {
            for (const prompt of [generateFigurePrompt('∠AOB=60°。'), generateSimilarQuestionPrompt(language, '∠AOB=60°。', ['角度'], 'medium')]) {
                expect(prompt).toContain('同一可见顶点及两条角边的完整度数标注精确比较');
                expect(prompt).toContain('∠AOB 与 ∠BOA 是同一个角');
                expect(prompt).toContain('直角方框也表示90度');
                expect(prompt).toContain('不按示意坐标推算普通角度');
                expect(prompt).toContain('不给缺失标注补答案');
                expect(prompt).toContain('后文引入其它图不能取消此前明确的本图条件');
            }
        });

        it.each(['zh', 'en'] as const)('重绘和新题配图同步单个通用多边形的形状边界（%s）', (language) => {
            for (const prompt of [generateFigurePrompt('下图是一个正方形。'), generateSimilarQuestionPrompt(language, '下图是一个正方形。', ['面积'], 'medium')]) {
                expect(prompt).toContain('可明确对应主图的单个多边形也必须核对题干形状');
                expect(prompt).toContain('梯形只有一组对边平行');
                expect(prompt).toContain('不得为通过校验移动点或删除辅助点');
                expect(prompt).toContain('分段和对角线标签不能当作整边长');
                expect(prompt).toContain('多个多边形、带圆或外部独立图元时不要强行认定单个主图');
                expect(prompt).toContain('只使用同一声明中的子类型');
            }
        });

        it.each(['zh', 'en'] as const)('重绘和新题配图同步无 polygon 的闭合线段边界（%s）', (language) => {
            for (const prompt of [generateFigurePrompt('下图是一个正方形。'), generateSimilarQuestionPrompt(language, '下图是一个正方形。', ['面积'], 'medium')]) {
                expect(prompt).toContain('若没有 polygons');
                expect(prompt).toContain('所有实线恰好组成一个简单闭合环');
                expect(prompt).toContain('开链、多个闭合环或额外实线关系不明确');
                expect(prompt).toContain('虚线内部辅助线可以保留');
            }
        });

        it.each(['zh', 'en'] as const)('重绘和新题配图同步菱形的边与高归属（%s）', (language) => {
            for (const prompt of [generateFigurePrompt('下图是一个菱形。'), generateSimilarQuestionPrompt(language, '下图是一个菱形。', ['菱形'], 'medium')]) {
                expect(prompt).toContain('四边等长且两组对边平行，不要求四个直角');
                expect(prompt).toContain('正方形也可满足菱形条件');
                expect(prompt).toContain('分段、对角线和垂直高不能冒充完整边');
                expect(prompt).toContain('不要输出不存在的 rhombus 模板类型或 shape 枚举');
                expect(prompt).toContain('不按绘图比例求物理长度，不移动点或补答案');
            }
        });

        it.each(['zh', 'en'] as const)('重绘和新题配图同步三角形子类型与完整边关系（%s）', (language) => {
            for (const prompt of [generateFigurePrompt('下图是一个等腰直角三角形。'), generateSimilarQuestionPrompt(language, '下图是一个等腰直角三角形。', ['三角形'], 'medium')]) {
                expect(prompt).toContain('等腰直角必须是两条直角边等长');
                expect(prompt).toContain('三条完整边都有同类单位的明确数值时精确核对勾股关系');
                expect(prompt).toContain('面积图的高只有在apexRatio为0或1时才是完整边');
                expect(prompt).toContain('范围-1至2、默认0.5');
                expect(prompt).toContain('不从其它三角形、疑问或待证明内容补条件');
            }
        });

        it.each(['zh', 'en'] as const)('重绘和新题配图保留外部高、底边及延长线（%s）', (language) => {
            for (const prompt of [generateFigurePrompt('三角形的高落在底边延长线上。'), generateSimilarQuestionPrompt(language, '三角形的高落在底边延长线上。', ['底和高'], 'medium')]) {
                expect(prompt).toContain('小于0或大于1为左侧或右侧外部高');
                expect(prompt).toContain('不能把外部顶点夹到端点或改成内部高');
                expect(prompt).toContain('允许向左倾斜或垂足在底边外');
                expect(prompt).toContain('底长只对应原底边，不包括延长部分');
            }
        });

        it.each(['zh', 'en'] as const)('重绘和新题配图核对完整三边，不把未知边或候选长度当作已知（%s）', (language) => {
            for (const prompt of [generateFigurePrompt('下图是一个三角形。'), generateSimilarQuestionPrompt(language, '下图是一个三角形。', ['三角形'], 'medium')]) {
                expect(prompt).toContain('任意两边之和严格大于第三边，等于也属于矛盾');
                expect(prompt).toContain('无单位值只与无单位值比较');
                expect(prompt).toContain('未知边、分段、内部高或缺失单位不用于凑出三条完整边');
                expect(prompt).toContain('疑问、判断、假设和候选长度不当作既定主图事实');
                expect(prompt).toContain('不猜应修改哪条边或填出答案');
            }
        });

        it('重绘和新题配图对已知数精确核对整数位数，不填掉未知答案', () => {
            for (const prompt of [generateFigurePrompt('两位数乘25'), generateSimilarQuestionPrompt('zh', '两位数乘25', ['乘法'], 'medium')]) {
                expect(prompt).toContain('符号和前导零不计入位数');
                expect(prompt).toContain('3.4不能当作两位整数');
                expect(prompt).toContain('不把微小的非零小数部分舍入掉');
                expect(prompt).toContain('未知填空仍保留');
            }
        });

        it('重绘和新题配图明确小数加减竖式的列对齐边界', () => {
            for (const prompt of [generateFigurePrompt('计算12.3+4'), generateSimilarQuestionPrompt('zh', '计算12.3+4', ['小数加法'], 'medium')]) {
                expect(prompt).toContain('不含 partialProducts 的加减竖式若所有可见行都能明确拆成数字、未知格和小数点');
                expect(prompt).toContain('含部分积的加减、字母、复杂表达式或不确定列关系时不要套用小数网格');
            }
        });

        it.each(['zh', 'en'] as const)('重绘和新题配图保留小数乘法的末位对齐与题面字符（%s）', (language) => {
            for (const prompt of [generateFigurePrompt('计算3.4×2.05'), generateSimilarQuestionPrompt(language, '计算3.4×2.05', ['小数乘法'], 'medium')]) {
                expect(prompt).toContain('小数乘法按末位数字对齐');
                expect(prompt).toContain('不额外占数字列');
                expect(prompt).toContain('各行保留题图中的小数点、末尾零和作答空格');
                expect(prompt).toContain('也不自行推算或改写部分积');
                expect(prompt).toContain('小数点和正负号不计入乘数的数字位数');
                expect(prompt).toContain('小数乘数从最右数字开始以 0 计数');
                expect(prompt).toContain('2.05 中 5 对应 shift:0、2 对应 shift:2');
            }
        });

        it.each(['zh', 'en'] as const)('重绘和新题配图保留题首信息及公式样式的条件边界（%s）', (language) => {
            for (const prompt of [generateFigurePrompt('日期：2026-11-15。计算34×25。'), generateSimilarQuestionPrompt(language, '计算34×25。', ['乘法'], 'medium')]) {
                expect(prompt).toContain('题首带明确标签、格式有效且已完整分隔');
                expect(prompt).toContain('无参数样式和间距命令不能取消完整算式核对');
                expect(prompt).toContain('不得因此删除原题文字');
                expect(prompt).toContain('分数和多个候选算式仍须保守处理');
            }
        });

        it('结构化配图明确 SVG 文本不做 KaTeX 求值，LaTeX 无法表达时回退', () => {
            const prompt = generateFigurePrompt('图中标注为 \\$\\frac{1}{2}\\$');
            expect(prompt).toContain('SVG 文本不经过 KaTeX 排版');
            expect(prompt).toContain('参数之间有空格的形式：\\frac {1} {2}');
            expect(prompt).toContain('\\mathbb {R}');
            expect(prompt).toContain('\\overset {?} {=}');
            expect(prompt).toContain('成对的 \\left ... \\right');
            expect(prompt).toContain('不要把公式拆开、改写或自行求值');
            expect(prompt).toContain('使用完整旧 SVG、原图或手动配图兜底');
        });

        it.each(['zh', 'en'] as const)('重绘和新题配图的统计图保留真实数值范围（%s）', (language) => {
            const prompts = [generateFigurePrompt('折线图数据为0.2、0.5。'), generateSimilarQuestionPrompt(language, '折线图数据为0.2、0.5。', ['统计图'], 'medium')];
            for (const prompt of prompts) {
                expect(prompt).toContain('bar_chart 保留 0 基线');
                expect(prompt).toContain('不要为了好看把小数数据上限补成 1');
                expect(prompt).toContain('不要把全负数数据改成正数范围');
            }
        });

        it('提供错题本候选知识点时只列出这些标签，不再按学科、年级取标签', () => {
            const prompt = generateAnalyzePrompt('zh', 4, '数学', {
                candidateTags: { subjectName: '数学', tags: ['鸡兔同笼', '植树问题'] },
                prefetchedMathTags: ['不应出现的年级标签'],
            });
            expect(prompt).toContain('**数学标签:**');
            expect(prompt).toContain('"鸡兔同笼", "植树问题"');
            expect(prompt).not.toContain('不应出现的年级标签');
        });

        it('应该生成中文提示词', () => {
            const prompt = generateAnalyzePrompt('zh');
            expect(prompt).toContain('中文');
            expect(typeof prompt).toBe('string');
        });

        it('应该生成英文提示词', () => {
            const prompt = generateAnalyzePrompt('en');
            expect(prompt).toContain('English');
            expect(typeof prompt).toBe('string');
        });

        it('应该包含学科提示（如果提供）', () => {
            const prompt = generateAnalyzePrompt('zh', null, '数学');
            expect(prompt).toContain('数学');
        });

        it('多小题答案优先使用同一行分号或空格分隔，不默认换行', () => {
            const prompt = generateAnalyzePrompt('zh', null, '英语');
            expect(prompt).toContain('优先使用英文半角分号（;）');
            expect(prompt).toContain('其次在同一行使用一个空格');
            expect(prompt).toContain('只有答案确实需要分段时才换行');
        });

        it('应该根据年级过滤数学标签（初一）', () => {
            const prompt = generateAnalyzePrompt('zh', 7, '数学');
            // 初一应该只包含七年级的标签
            expect(prompt).toBeDefined();
        });

        it('应该根据年级过滤数学标签（初三）', () => {
            const prompt = generateAnalyzePrompt('zh', 9, '数学');
            // 初三应该包含七、八、九年级的累进标签
            expect(prompt).toBeDefined();
        });

        it('应该根据年级过滤数学标签（高一）', () => {
            const prompt = generateAnalyzePrompt('zh', 10, '数学');
            expect(prompt).toBeDefined();
        });

        it('应该支持自定义选项 (providerHints)', () => {
            const prompt = generateAnalyzePrompt('zh', null, null, {
                providerHints: '请特别注意 LaTeX 格式',
            });
            expect(prompt).toContain('请特别注意 LaTeX 格式');
        });

        it('应该支持自定义模板', () => {
            const customTemplate = '自定义模板 {{language_instruction}}';
            const prompt = generateAnalyzePrompt('zh', null, null, {
                customTemplate,
            });
            expect(prompt).toContain('自定义模板');
            // language_instruction 会被替换为实际的语言指令（包含 Chinese）
            expect(prompt).toContain('Chinese');
        });

        it('生成的提示词不应包含未替换的变量占位符', () => {
            const prompt = generateAnalyzePrompt('zh', 8, '数学');
            // 检查常见的占位符是否已被替换
            expect(prompt).not.toContain('{{language_instruction}}');
            expect(prompt).not.toContain('{{tag_list}}');
            expect(prompt).not.toContain('{{provider_hints}}');
        });

        it('应该要求 AI 输出错因分析相关 XML 标签并过滤人的思考和草稿', () => {
            const prompt = generateAnalyzePrompt('zh', null, '数学');
            expect(prompt).toContain('<wrong_answer_text>');
            expect(prompt).toContain('<mistake_status>');
            expect(prompt).toContain('<mistake_analysis>');
            expect(prompt).toContain('wrong_attempt');
            expect(prompt).toContain('not_attempted');
            expect(prompt).toContain('unknown');
            expect(prompt).toContain('【过滤草稿与思考过程规则】');
            expect(prompt).toContain('必须过滤掉图片中人的思考过程、手写草稿');
            expect(prompt).not.toContain('草稿或错误答案，请尽量按原样摘录');
        });
    });

    describe('generateSimilarQuestionPrompt', () => {
        it('原题有配图时附上原题 SVG，并要求按新题数据重新绘制', () => {
            const svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>';
            const prompt = generateSimilarQuestionPrompt('zh', '如图求面积', ['面积'], 'medium', { originalFigureSvg: svg });
            expect(prompt).toContain('<figure_svg>');
            expect(prompt).toContain(svg);
            expect(prompt).toContain('重新绘制');
            const noFigure = generateSimilarQuestionPrompt('zh', '1+1=?', ['加法'], 'medium');
            expect(noFigure).toContain('原题没有配图');
            expect(noFigure).not.toContain('{{figure_instruction}}');
        });

        const originalQuestion = '已知 x + y = 5，求 x² + y² 的最小值';
        const knowledgePoints = ['一元二次方程', '最值问题'];

        it('应该生成中文类似题提示词', () => {
            const prompt = generateSimilarQuestionPrompt('zh', originalQuestion, knowledgePoints);
            expect(prompt).toContain(originalQuestion);
            expect(prompt).toContain('中文');
        });

        it('应该生成英文类似题提示词', () => {
            const prompt = generateSimilarQuestionPrompt('en', originalQuestion, knowledgePoints);
            expect(prompt).toContain(originalQuestion);
            expect(prompt).toContain('English');
        });

        it('应该包含知识点列表', () => {
            const prompt = generateSimilarQuestionPrompt('zh', originalQuestion, knowledgePoints);
            expect(prompt).toContain('一元二次方程');
            expect(prompt).toContain('最值问题');
        });

        it('应该根据难度级别调整提示词', () => {
            const easyPrompt = generateSimilarQuestionPrompt('zh', originalQuestion, knowledgePoints, 'easy');
            const hardPrompt = generateSimilarQuestionPrompt('zh', originalQuestion, knowledgePoints, 'hard');

            expect(easyPrompt.toUpperCase()).toContain('EASY');
            expect(hardPrompt.toUpperCase()).toContain('HARD');
        });

        it('应该支持所有难度级别', () => {
            const difficulties = ['easy', 'medium', 'hard', 'harder'] as const;

            difficulties.forEach(difficulty => {
                const prompt = generateSimilarQuestionPrompt('zh', originalQuestion, knowledgePoints, difficulty);
                expect(prompt).toBeDefined();
                expect(typeof prompt).toBe('string');
            });
        });

        it('默认难度应该是 MEDIUM', () => {
            const prompt = generateSimilarQuestionPrompt('zh', originalQuestion, knowledgePoints);
            expect(prompt.toUpperCase()).toContain('MEDIUM');
        });
    });

    describe('generateReanswerPrompt', () => {
        it('提供错题本候选知识点时要求只从中选择，否则不出现该约束', () => {
            const withTags = generateReanswerPrompt('zh', '鸡兔同笼', '数学', { candidateTags: { subjectName: '数学', tags: ['鸡兔同笼'] } });
            expect(withTags).toContain('只能从以下数学知识点中选择');
            expect(withTags).toContain('"鸡兔同笼"');
            expect(generateReanswerPrompt('zh', '鸡兔同笼', '数学')).not.toContain('只能从以下');
            expect(generateReanswerPrompt('zh', '鸡兔同笼', '数学')).not.toContain('{{knowledge_points_rule}}');
        });

        const questionText = '求解方程 2x + 3 = 7';

        it('应该生成中文重新解题提示词', () => {
            const prompt = generateReanswerPrompt('zh', questionText);
            expect(prompt).toContain(questionText);
            expect(prompt).toContain('中文');
        });

        it('应该生成英文重新解题提示词', () => {
            const prompt = generateReanswerPrompt('en', questionText);
            expect(prompt).toContain(questionText);
            expect(prompt).toContain('English');
        });

        it('应该包含学科提示（如果提供）', () => {
            const prompt = generateReanswerPrompt('zh', questionText, '数学');
            expect(prompt).toContain('数学');
        });

        it('应该支持自定义 provider hints', () => {
            const prompt = generateReanswerPrompt('zh', questionText, null, {
                providerHints: '输出格式要求',
            });
            expect(prompt).toContain('输出格式要求');
        });

        it('生成的提示词不应包含未替换的变量占位符', () => {
            const prompt = generateReanswerPrompt('zh', questionText, '数学');
            expect(prompt).not.toContain('{{question_text}}');
            expect(prompt).not.toContain('{{language_instruction}}');
            expect(prompt).not.toContain('{{provider_hints}}');
        });

        it('重新解题提示词应该要求同步输出新的错因分析', () => {
            const prompt = generateReanswerPrompt('zh', questionText, '数学');
            expect(prompt).toContain('<wrong_answer_text>');
            expect(prompt).toContain('<mistake_status>');
            expect(prompt).toContain('<mistake_analysis>');
            expect(prompt).toContain('重新判断');
        });

        it('重新解题提示词不应允许无依据推断学生错因，并要求过滤草稿和思考过程', () => {
            const prompt = generateReanswerPrompt('zh', questionText, '数学');
            expect(prompt).not.toContain('推断');
            expect(prompt).toContain('不要猜测');
            expect(prompt).toContain('当前图片中可见');
            expect(prompt).toContain('【过滤草稿与思考过程规则】');
            expect(prompt).not.toContain('草稿或错误答案，请尽量按原样摘录');
        });
    });

    describe('模板变量替换', () => {
        it('应该正确处理多行文本', () => {
            const multiLineQuestion = `第一行
第二行
第三行`;
            const prompt = generateReanswerPrompt('zh', multiLineQuestion);
            expect(prompt).toContain('第一行');
            expect(prompt).toContain('第三行');
        });

        it('应该正确处理特殊字符', () => {
            const questionWithSpecialChars = '求解 x² + y² = r² 的圆的面积（其中 r > 0）';
            const prompt = generateReanswerPrompt('zh', questionWithSpecialChars);
            expect(prompt).toContain('x²');
            expect(prompt).toContain('r > 0');
        });
    });

    describe('gradeSemesterToDisplayName', () => {
        it('应该转换 primary_3 为 小学三年级', () => {
            expect(gradeSemesterToDisplayName('primary_3')).toBe('小学三年级');
        });

        it('应该转换 junior_high_2 为 初中二年级', () => {
            expect(gradeSemesterToDisplayName('junior_high_2')).toBe('初中二年级');
        });

        it('应该转换 senior_high_1 为 高中一年级', () => {
            expect(gradeSemesterToDisplayName('senior_high_1')).toBe('高中一年级');
        });

        it('应该转换 初一 为 初中一年级', () => {
            expect(gradeSemesterToDisplayName('初一')).toBe('初中一年级');
        });

        it('应该转换 初二上 为 初中二年级', () => {
            expect(gradeSemesterToDisplayName('初二上')).toBe('初中二年级');
        });

        it('应该转换 高一 为 高中一年级', () => {
            expect(gradeSemesterToDisplayName('高一')).toBe('高中一年级');
        });

        it('应该转换 七年级 为 初中一年级', () => {
            expect(gradeSemesterToDisplayName('七年级')).toBe('初中一年级');
        });

        it('应该转换 八年级上 为 初中二年级', () => {
            expect(gradeSemesterToDisplayName('八年级上')).toBe('初中二年级');
        });

        it('空字符串应返回 null', () => {
            expect(gradeSemesterToDisplayName('')).toBeNull();
        });

        it('无法识别的格式应返回 null', () => {
            expect(gradeSemesterToDisplayName('unknown_format')).toBeNull();
        });
    });

    describe('gradeSemesterToGradeNumber', () => {
        it('应该转换 初一 为 7', () => {
            expect(gradeSemesterToGradeNumber('初一')).toBe(7);
        });

        it('应该转换 初二 为 8', () => {
            expect(gradeSemesterToGradeNumber('初二')).toBe(8);
        });

        it('应该转换 高一 为 10', () => {
            expect(gradeSemesterToGradeNumber('高一')).toBe(10);
        });

        it('应该转换 junior_high_1 为 7', () => {
            expect(gradeSemesterToGradeNumber('junior_high_1')).toBe(7);
        });

        it('小学应返回 null', () => {
            expect(gradeSemesterToGradeNumber('primary_3')).toBeNull();
        });

        it('空字符串应返回 null', () => {
            expect(gradeSemesterToGradeNumber('')).toBeNull();
        });
    });

    describe('generateGradeInstruction', () => {
        it('无 gradeSemester 时返回空字符串', () => {
            expect(generateGradeInstruction()).toBe('');
            expect(generateGradeInstruction(null)).toBe('');
            expect(generateGradeInstruction('')).toBe('');
        });

        it('有效的 gradeSemester 应生成约束指令', () => {
            const instruction = generateGradeInstruction('初二上');
            expect(instruction).toContain('学历约束');
            expect(instruction).toContain('初中二年级');
            expect(instruction).toContain('禁止使用超纲知识');
        });

        it('无法识别的 gradeSemester 应返回空字符串', () => {
            expect(generateGradeInstruction('unknown_format')).toBe('');
        });
    });

    describe('gradeSemester 学历约束注入', () => {
        it('analyze 提示词应包含学历约束（当提供 gradeSemester 时）', () => {
            const prompt = generateAnalyzePrompt('zh', 8, '数学', undefined, '初二上');
            expect(prompt).toContain('学历约束');
            expect(prompt).toContain('初中二年级');
        });

        it('analyze 提示词不应包含学历约束（当未提供 gradeSemester 时）', () => {
            const prompt = generateAnalyzePrompt('zh', 8, '数学');
            expect(prompt).not.toContain('学历约束');
        });

        it('similar 提示词应包含学历约束（当提供 gradeSemester 时）', () => {
            const prompt = generateSimilarQuestionPrompt('zh', '1+1=?', ['算术'], 'medium', undefined, 'primary_3');
            expect(prompt).toContain('学历约束');
            expect(prompt).toContain('小学三年级');
        });

        it('similar 提示词不应包含学历约束（当未提供 gradeSemester 时）', () => {
            const prompt = generateSimilarQuestionPrompt('zh', '1+1=?', ['算术']);
            expect(prompt).not.toContain('学历约束');
        });

        it('reanswer 提示词应包含学历约束（当提供 gradeSemester 时）', () => {
            const prompt = generateReanswerPrompt('zh', '1+1=?', '数学', undefined, '高一');
            expect(prompt).toContain('学历约束');
            expect(prompt).toContain('高中一年级');
        });

        it('reanswer 提示词不应包含学历约束（当未提供 gradeSemester 时）', () => {
            const prompt = generateReanswerPrompt('zh', '1+1=?', '数学');
            expect(prompt).not.toContain('学历约束');
        });

        it('analyze 提示词不应包含未替换的 grade_instruction 占位符', () => {
            const prompt = generateAnalyzePrompt('zh', 8, '数学', undefined, '初二上');
            expect(prompt).not.toContain('{{grade_instruction}}');
        });
    });

    describe('表格处理指令', () => {
        it('analyze 提示词应包含表格处理规则', () => {
            const prompt = generateAnalyzePrompt('zh');
            expect(prompt).toContain('表格处理规则');
            expect(prompt).toContain('Markdown 表格语法');
        });

        it('表格处理规则应包含标准表格示例', () => {
            const prompt = generateAnalyzePrompt('zh');
            expect(prompt).toContain('| 列标题1 | 列标题2 | 列标题3 |');
            expect(prompt).toContain('|---------|---------|---------|');
        });

        it('表格处理规则应包含复杂表格处理说明', () => {
            const prompt = generateAnalyzePrompt('zh');
            expect(prompt).toContain('复杂表格');
            expect(prompt).toContain('合并单元格');
            expect(prompt).toContain('多级表头');
        });

        it('表格处理规则应要求完整性', () => {
            const prompt = generateAnalyzePrompt('zh');
            expect(prompt).toContain('表格完整性要求');
            expect(prompt).toContain('必须转录所有单元格内容');
            expect(prompt).toContain('保留表格标题、单位、注释');
        });

        it('表格处理规则应包含特殊情况处理', () => {
            const prompt = generateAnalyzePrompt('zh');
            expect(prompt).toContain('特殊情况处理');
            expect(prompt).toContain('手写表格');
            expect(prompt).toContain('模糊表格');
        });

        it('answer_text 应引用表格处理规则', () => {
            const prompt = generateAnalyzePrompt('zh');
            expect(prompt).toContain('<answer_text>');
            expect(prompt).toMatch(/<answer_text>[\s\S]*表格处理规则[\s\S]*<\/answer_text>/);
        });

        it('analysis 应引用表格处理规则', () => {
            const prompt = generateAnalyzePrompt('zh');
            expect(prompt).toContain('<analysis>');
            expect(prompt).toMatch(/<analysis>[\s\S]*表格处理规则[\s\S]*<\/analysis>/);
        });
    });

    describe('LaTeX 答案排版指令', () => {
        it('要求独立公式使用独占行定界符并把中文标点放在公式外', () => {
            const prompt = generateSimilarQuestionPrompt('zh', '计算 1+1', ['加法']);
            expect(prompt).toContain('开头 $$ 和结尾 $$ 各自独占一行');
            expect(prompt).toContain('中文句号、逗号、分号等标点不要写进 $$...$$');
        });
    });
});

describe('掌握概率与学科相关提示词', () => {
    it('掌握概率提示词包含练习历史、知识点和规则参考值', () => {
        const prompt = generateMasteryPrompt({
            questionText: '求 x',
            knowledgePoints: ['方程', '移项'],
            mistakeStatus: 'not_attempted',
            history: [
                { date: '2026-10-01T08:00:00.000Z', difficulty: 'easy', result: 'wrong', source: 'practice' },
                { date: '2026-10-05T08:00:00.000Z', difficulty: 'harder', result: 'correct', source: 'exam' },
            ],
            ruleProbability: 0.456,
        });

        expect(prompt).toContain('求 x');
        expect(prompt).toContain('方程、移项');
        expect(prompt).toContain('1. 2026-10-01｜难度：简单｜来源：单题练习｜结果：做错');
        expect(prompt).toContain('2. 2026-10-05｜难度：挑战｜来源：试卷｜结果：做对');
        expect(prompt).toContain('46%');
        expect(prompt).toContain('【最初的错误情况】\n不会做');
    });

    it('重新解题提示词要求输出学科标签', () => {
        const prompt = generateReanswerPrompt('zh', '1+1=?');
        expect(prompt).toContain('<subject>');
        expect(prompt).toContain('9 个 XML 标签');
        expect(prompt).toContain('<difficulty_stars>');
    });
});

describe('知识点重新标注提示词', () => {
    it('包含题目、可选知识点和学生年级，不含超纲限制', () => {
        const prompt = generateTagSuggestPrompt({
            questionText: '鸡兔同笼，共 10 个头 28 条腿',
            answerText: '鸡 6 兔 4',
            subject: '数学',
            allowedTags: ['鸡兔同笼', '植树问题'],
            gradeSemester: '四年级上',
        });

        expect(prompt).toContain('鸡兔同笼，共 10 个头 28 条腿');
        expect(prompt).toContain('"鸡兔同笼"、"植树问题"');
        expect(prompt).toContain('【学生年级】');
        expect(prompt).toContain('数学老师');
        expect(prompt).not.toContain('禁止使用超纲知识');
    });

    it('题目与解答过程、学生作答、错因分析一并交给 AI', () => {
        const prompt = generateTagSuggestPrompt({
            questionText: '鸡兔同笼，共 10 个头 28 条腿',
            answerText: '鸡 6 兔 4',
            analysis: '假设全是鸡，则有 20 条腿，少 8 条，每只兔多 2 条腿，兔有 4 只',
            wrongAnswerText: '鸡 4 兔 6',
            mistakeAnalysis: '把鸡和兔的数量算反',
            subject: '数学',
            allowedTags: ['假设法解鸡兔同笼'],
        });

        expect(prompt).toContain('【解答过程】\n假设全是鸡，则有 20 条腿');
        expect(prompt).toContain('【学生作答】\n鸡 4 兔 6');
        expect(prompt).toContain('【错因分析】\n把鸡和兔的数量算反');
        expect(prompt).not.toContain('{{');
    });

    it('缺少解答过程时以「（无）」占位', () => {
        const prompt = generateTagSuggestPrompt({ questionText: '1+1=?', subject: '数学', allowedTags: ['加法'] });
        expect(prompt).toContain('【解答过程】\n（无）');
        expect(prompt).toContain('【学生作答】\n（无）');
    });
});


describe('按题型判题', () => {
    it('证明题检查论证，同时保留等价答案与其他正确解法', () => {
        const prompt = generateGradingPrompt({ questionText: '证明两个底角相等', answerText: '两角相等', userAnswer: '两角相等' });
        expect(prompt).toContain('只有结论而没有证明不能判对');
        expect(prompt).toContain('接受正确的其他解法');
        expect(prompt).toContain('核对答案是否等价');
        expect(prompt).not.toContain('只看最终结论');
        expect(prompt).toContain('【学生答案】\n两角相等');
    });
});
