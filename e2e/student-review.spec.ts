import { test, expect } from './support/fixtures';

test('学生按复习计划进入空白作答，无到期题时显示最近批改，管理员保留历史详情', async ({ page, scenario }) => {
    const item = await scenario.item('R', {
        questionText: `复习计划回归题 ${scenario.id}：计算 1 + 1。`,
        answerText: '2',
        analysis: '先计算加法。',
    });
    await scenario.db.user.update({ where: { id: scenario.otherUser.id }, data: { role: 'user' } });

    const oldCreatedAt = new Date(Date.now() - 60_000);
    const previousSubmission = await scenario.db.studentSubmission.create({
        data: {
            userId: scenario.otherUser.id,
            kind: 'review',
            status: 'completed',
            totalCount: 1,
            gradedCount: 1,
            correctCount: 0,
            createdAt: oldCreatedAt,
            completedAt: oldCreatedAt,
            answers: { create: {
                errorItemId: item.id,
                questionText: item.questionText ?? '',
                answerText: item.answerText ?? '',
                analysis: item.analysis,
                userAnswer: '旧答案',
                status: 'graded',
                isCorrect: false,
                reason: '旧判题',
                mistakeAnalysis: '旧错因',
                createdAt: oldCreatedAt,
            } },
        },
    });

    await scenario.login(page, true);
    await page.goto('/review');
    await expect(page.getByText(`复习计划回归题 ${scenario.id}`, { exact: false })).toBeVisible();
    await expect(page.locator('textarea').first()).toHaveValue('');
    await expect(page.getByText('旧答案', { exact: true })).toHaveCount(0);
    await expect(page.getByText('旧判题', { exact: true })).toHaveCount(0);

    await page.locator('textarea').first().fill('当前答案');
    await page.getByRole('button', { name: '提交今日复习', exact: true }).click();
    await expect(page.getByText('批改完成', { exact: true })).toBeVisible();
    await expect(page.getByText('当前答案', { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByText('最近一次结果', { exact: true })).toBeVisible();
    await expect(page.getByText('当前答案', { exact: true })).toBeVisible();
    await expect(page.getByText('旧答案', { exact: true })).toHaveCount(0);

    const latest = await scenario.db.studentSubmission.findFirstOrThrow({ where: { userId: scenario.otherUser.id, kind: 'review' }, orderBy: { createdAt: 'desc' } });
    await scenario.login(page);
    const listResponse = await page.request.get(`/api/admin/users/${scenario.otherUser.id}/submissions?kind=review&page=1&pageSize=10`);
    expect(listResponse.ok()).toBeTruthy();
    const list = await listResponse.json() as { pagination: { total: number }; submissions: { id: string }[] };
    expect(list.pagination.total).toBe(2);
    expect(list.submissions.map((submission) => submission.id)).toContain(latest.id);

    const detailResponse = await page.request.get(`/api/admin/users/${scenario.otherUser.id}/submissions/${latest.id}?page=1&pageSize=5`);
    expect(detailResponse.ok()).toBeTruthy();
    const detail = await detailResponse.json() as { status: string; answers: { userAnswer: string | null; answerText: string | null }[] };
    expect(detail).toMatchObject({ status: 'completed' });
    expect(detail.answers[0]).toMatchObject({ userAnswer: '当前答案', answerText: '2' });

    const previousDetailResponse = await page.request.get(`/api/admin/users/${scenario.otherUser.id}/submissions/${previousSubmission.id}?page=1&pageSize=5`);
    expect(previousDetailResponse.ok()).toBeTruthy();
    const previousDetail = await previousDetailResponse.json() as { answers: { userAnswer: string | null }[] };
    expect(previousDetail.answers[0].userAnswer).toBe('旧答案');
});
