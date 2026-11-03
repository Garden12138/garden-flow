// Bounded RFC 4180 parser. No formulas or scripts are evaluated, and no file paths are accepted.
export function parseMetricCsv(csv: string): string[][] {
    if (csv.length > 1000000) throw new Error('CSV 超过 100 万字符');
    csv = csv.replace(/^\uFEFF/, '');
    const rows: string[][] = []; let row: string[] = []; let field = ''; let quoted = false; let closed = false;
    const cell = () => { row.push(field); field = ''; closed = false; if (row.length > 50) throw new Error('CSV 列数超过 50'); };
    const line = () => { cell(); rows.push(row); row = []; if (rows.length > 1001) throw new Error('CSV 最多 1000 条观测'); };
    for (let index = 0; index < csv.length; index++) {
        const char = csv[index];
        if (quoted) {
            if (char === '"' && csv[index + 1] === '"') { field += '"'; index++; }
            else if (char === '"') { quoted = false; closed = true; }
            else field += char;
        } else if (char === ',') cell();
        else if (char === '\r' || char === '\n') { if (char === '\r' && csv[index + 1] === '\n') index++; line(); }
        else if (char === '"' && !field && !closed) quoted = true;
        else { if (closed || char === '"') throw new Error('CSV 引号格式错误'); field += char; }
    }
    if (quoted) throw new Error('CSV 引号未闭合');
    if (field || row.length || closed) line();
    return rows;
}

/** Fill unassigned rows from an explicitly selected publication; existing row links stay unchanged. */
export function bindMetricCsvToPublication(csv: string, column: string, publicationId: string): string {
    const [headers, ...rows] = parseMetricCsv(csv);
    if (!headers?.length || new Set(headers).size !== headers.length) throw new Error('CSV 标题缺失或重复');
    if (!column) throw new Error('请指定作品关联列名');
    let index = headers.indexOf(column);
    if (index < 0) { index = headers.length; headers.push(column); }
    for (const row of rows) {
        if (row.length > headers.length) throw new Error('CSV 列数与标题不匹配');
        while (row.length < headers.length) row.push('');
        if (!row[index].trim()) row[index] = publicationId;
    }
    const escape = (value: string) => /[,"\r\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
    return [headers, ...rows].map(row => row.map(escape).join(',')).join('\n');
}
