export const TASK_TITLE_MAX = 60;
export const TASK_GOAL_MAX = 2000;

export function normalizeTaskTitle(value) {
    if (typeof value !== 'string' || !value.trim()) throw new Error('任务标题不能为空');
    const title = value.trim();
    if (/[\r\n]/.test(title)) throw new Error('任务标题请使用单行文字');
    if ([...title].length > TASK_TITLE_MAX) throw new Error(`任务标题最多 ${TASK_TITLE_MAX} 字`);
    return title;
}
