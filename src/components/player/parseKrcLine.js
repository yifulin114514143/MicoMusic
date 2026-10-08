// 新增 timingSource 明确区分真实 KRC 词组时间与旧播放器的行级等分回退。
// characters/highlighted 保持旧结构，沉浸视图只对 word 来源做逐词动画。
export function parseKrcLine(line) {
    const match = String(line).match(/^\[(\d+),(\d+)\](.*)/);
    if (!match) return null;
    const startTime = Number(match[1]);
    const duration = Number(match[2]);
    const characters = [];
    const groups = /<(\d+),(\d+),\d+>([^<]+)/g;
    let group;
    while ((group = groups.exec(match[3])) !== null) {
        const start = startTime + Number(group[1]);
        characters.push({ char: group[3], startTime: start, endTime: start + Number(group[2]), highlighted: false });
    }
    const timingSource = characters.length ? 'word' : 'line';
    if (!characters.length) {
        const text = match[3].replace(/<.*?>/g, '');
        if (text.trim()) for (let index = 0; index < text.length; index++) {
            characters.push({ char: text[index], startTime: startTime + index * duration / text.length,
                endTime: startTime + (index + 1) * duration / text.length, highlighted: false });
        }
    }
    return characters.length ? { characters, startTime, endTime: startTime + duration, timingSource } : null;
}
