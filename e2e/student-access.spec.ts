import { test, expect } from './support/fixtures';

test('学生共享管理员题库和试卷，界面与接口隐藏参考答案及原图', async ({ page, scenario }) => {
    const questionText = `学生共享题库验证 ${scenario.id}：1 + 1 = ?\nA. 2\nB. 3`;
    const privateAnswer = `教师参考解答-${scenario.id}`;
    const item = await scenario.item('S', { questionText, answerText: privateAnswer, analysis: privateAnswer });
    const title = `管理员共享试卷-${scenario.id}`;
    const paper = await scenario.db.examPaper.create({ data: {
        userId: scenario.user.id, title, status: 'ready', scope: 'all', difficulty: 'medium', requestedCount: 1, subjectIds: JSON.stringify([scenario.book.id]),
        questions: { create: { order: 0, errorItemId: item.id, sourceShortId: item.shortId ?? '', questionText, answerText: privateAnswer, analysis: privateAnswer } },
    } });
    await scenario.db.user.update({ where: { id: scenario.otherUser.id }, data: { role: 'user' } });
    await scenario.login(page, true);

    await page.goto('/review');
    await expect(page.getByText(`学生共享题库验证 ${scenario.id}`, { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: '录入', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: '错题本', exact: true })).toBeDisabled();
    await expect(page.locator('svg.lucide-settings')).toHaveCount(0);
    await expect(page.getByText(privateAnswer, { exact: false })).toHaveCount(0);
    const due = await (await page.request.get('/api/review/due')).json();
    const shared = due.items.find((entry: { id: string }) => entry.id === item.id);
    expect(shared).toBeTruthy();
    expect(shared).not.toHaveProperty('answerText');
    expect(shared).not.toHaveProperty('analysis');
    expect(shared).not.toHaveProperty('originalImageUrl');
    expect((await page.request.get('/api/export')).status()).toBe(403);

    await page.goto('/exams');
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    await page.goto(`/exams/${paper.id}`);
    await expect(page.getByText(`学生共享题库验证 ${scenario.id}`, { exact: false })).toBeVisible();
    await expect(page.getByText(privateAnswer, { exact: false })).toHaveCount(0);
    const exam = await (await page.request.get(`/api/exams/${paper.id}`)).json();
    expect(JSON.stringify(exam)).not.toContain(privateAnswer);
});
