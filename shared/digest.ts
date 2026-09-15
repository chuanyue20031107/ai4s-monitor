export interface DigestItem {
  source: string;
  score: string;
  summary: string;
  links: string[];
}

export interface DigestCategory {
  name: string;
  items: DigestItem[];
}

export interface DigestBlock {
  title: string;
  categories: DigestCategory[];
  trends: string[];
}

const CATEGORY_LINE_RE = /^(?:分类[：:]\s*)?(模型|数据|AI4S\s*应用|自动化实验室|产业与商业|其他)\s*[：:]?\s*$/;

function normalizeCategoryName(name: string): string {
  const stripped = name.replace(/\s+/g, '');
  if (stripped === 'AI4S应用') return 'AI4S 应用';
  return name.trim();
}

function parseItem(paragraph: string[]): DigestItem | null {
  const item: DigestItem = { source: '', score: '', summary: '', links: [] };
  for (const raw of paragraph) {
    const line = raw.trim();
    const src = line.match(/^来源[：:]\s*(.+)$/);
    if (src) {
      item.source = src[1].trim();
      continue;
    }
    const score = line.match(/^评分[：:]\s*(.+)$/);
    if (score) {
      item.score = score[1].trim();
      continue;
    }
    const summary = line.match(/^摘要[：:]\s*(.+)$/);
    if (summary) {
      item.summary = summary[1].trim();
      continue;
    }
    const link = line.match(/^原文链接[：:]\s*(.+)$/);
    if (link) {
      const url = link[1].trim();
      if (!item.links.includes(url)) item.links.push(url);
    }
  }
  return item.source ? item : null;
}

function splitParagraphs(lines: string[]): string[][] {
  const paragraphs: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.trim() === '') {
      if (current.length > 0) paragraphs.push(current);
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) paragraphs.push(current);
  return paragraphs;
}

function clampSentences(text: string, max: number): string {
  const parts = text.split(/([。！？!?；;])/).filter((p) => p !== '');
  const sentences: string[] = [];
  let buffer = '';
  for (const part of parts) {
    buffer += part;
    if (/[。！？!?；;]/.test(part)) {
      sentences.push(buffer);
      buffer = '';
    }
  }
  if (buffer.trim() !== '') sentences.push(buffer);
  return sentences.slice(0, max).join('');
}

function mergeSameSourceItems(items: DigestItem[]): DigestItem[] {
  const merged: DigestItem[] = [];
  for (const item of items) {
    const existing = merged.find((m) => m.source === item.source && m.score === item.score);
    if (existing) {
      if (item.summary) {
        const combined = existing.summary ? `${existing.summary}${item.summary}` : item.summary;
        existing.summary = clampSentences(combined, 3);
      }
      for (const link of item.links) {
        if (!existing.links.includes(link)) existing.links.push(link);
      }
    } else {
      merged.push({ ...item, links: [...item.links] });
    }
  }
  return merged;
}

function scoreValue(score: string): number | null {
  const m = score.match(/^(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function parseSection(title: string, lines: string[]): DigestBlock | null {
  if (title.includes('趋势')) {
    const trends = splitParagraphs(lines)
      .map((p) => p.map((l) => l.trim()).join(' ').replace(/^\d+\s*[.、)．]\s*/, '').trim())
      .filter((t) => t.length > 0 && t !== '暂无相关情报');
    return trends.length > 0 ? { title, categories: [], trends } : null;
  }

  const buckets: { name: string; paragraphs: string[][] }[] = [];
  let current: { name: string; paragraphs: string[][] } | null = null;
  let paragraph: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length > 0 && current) current.paragraphs.push(paragraph);
    paragraph = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') {
      flushParagraph();
      continue;
    }
    const matched = trimmed.match(CATEGORY_LINE_RE);
    if (matched) {
      flushParagraph();
      if (current) buckets.push(current);
      current = { name: normalizeCategoryName(matched[1]), paragraphs: [] };
      continue;
    }
    if (!current) current = { name: '', paragraphs: [] };
    paragraph.push(line);
  }
  flushParagraph();
  if (current) buckets.push(current);

  const categories: DigestCategory[] = [];
  const isKeySection = title.includes('重点');
  for (const bucket of buckets) {
    let items = bucket.paragraphs
      .map((p) => parseItem(p))
      .filter((it): it is DigestItem => it !== null);
    if (isKeySection) {
      items = items.filter((it) => {
        const v = scoreValue(it.score);
        return v === null || v === 5;
      });
    }
    if (items.length > 0) {
      categories.push({ name: bucket.name, items: mergeSameSourceItems(items) });
    }
  }
  if (categories.length === 0) return null;
  return { title, categories, trends: [] };
}

export function parseDigest(content: string): DigestBlock[] | null {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const sections: { title: string; lines: string[] }[] = [];
  let current: { title: string; lines: string[] } | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    const matched = line.match(/^[#*\s]*[【[]([^】\]]+)[】\]]\s*[#*\s]*$/);
    if (matched && matched[1].length <= 8) {
      if (current) sections.push(current);
      current = { title: `【${matched[1].trim()}】`, lines: [] };
      continue;
    }
    if (current) current.lines.push(raw);
  }
  if (current) sections.push(current);
  if (sections.length === 0) return null;

  const blocks = sections
    .map((s) => parseSection(s.title, s.lines))
    .filter((b): b is DigestBlock => b !== null);
  return blocks.length > 0 ? blocks : null;
}

export function digestToFeishuMarkdown(content: string): string {
  const blocks = parseDigest(content);
  if (!blocks) return content;
  const parts: string[] = [];
  for (const block of blocks) {
    parts.push(`**${block.title}**`);
    for (const cat of block.categories) {
      const catParts: string[] = [];
      if (cat.name) catParts.push(`**${cat.name}**`);
      for (const item of cat.items) {
        const lines: string[] = [`**${item.source}** 评分：<font color='green'>${item.score}</font>`];
        if (item.summary) lines.push(item.summary);
        for (const link of item.links) {
          lines.push(`**原文链接：**[${link}](${link})`);
        }
        catParts.push(lines.join('\n'));
      }
      parts.push(catParts.join('\n\n'));
    }
    if (block.trends.length > 0) {
      parts.push(block.trends.map((t, i) => `**${i + 1}.** ${t}`).join('\n'));
    }
  }
  return parts.join('\n\n');
}

interface FlatDigestEntry {
  blockTitle: string;
  catName: string;
  item: DigestItem;
}

export function digestToFeishuMarkdownBudget(content: string, maxLen: number): string {
  const full = digestToFeishuMarkdown(content);
  if (full.length <= maxLen) return full;

  const blocks = parseDigest(content);
  if (!blocks) return content.slice(0, maxLen);

  const entries: FlatDigestEntry[] = [];
  const trendParts: string[] = [];
  for (const block of blocks) {
    for (const cat of block.categories) {
      for (const item of cat.items) {
        entries.push({ blockTitle: block.title, catName: cat.name, item });
      }
    }
    for (const t of block.trends) trendParts.push(t);
  }
  entries.sort(
    (a, b) => (scoreValue(b.item.score) ?? 0) - (scoreValue(a.item.score) ?? 0),
  );

  const parts: string[] = [];
  let used = 0;
  let lastBlock = '';
  let lastCat = '';
  let omittedItems = 0;
  for (const e of entries) {
    const lines: string[] = [`**${e.item.source}** 评分：<font color='green'>${e.item.score}</font>`];
    if (e.item.summary) lines.push(e.item.summary);
    for (const link of e.item.links) {
      lines.push(`**原文链接：**[${link}](${link})`);
    }
    const prefix: string[] = [];
    if (e.blockTitle !== lastBlock) {
      prefix.push(`**${e.blockTitle}**`);
      lastCat = '';
    }
    if (e.catName !== '' && e.catName !== lastCat) prefix.push(`**${e.catName}**`);
    const seg = [...prefix, lines.join('\n')].join('\n\n');
    const addLen = seg.length + (parts.length > 0 ? 2 : 0);
    if (used + addLen + 40 > maxLen) {
      omittedItems += 1;
      continue;
    }
    parts.push(seg);
    used += addLen;
    lastBlock = e.blockTitle;
    lastCat = e.catName;
  }

  let omittedTrends = 0;
  if (trendParts.length > 0 && used + 20 <= maxLen) {
    const trendLines: string[] = ['**【趋势观察】**'];
    let trendUsed = trendLines[0].length;
    let idx = 1;
    for (const t of trendParts) {
      const line = `**${idx}.** ${t}`;
      const addLen = line.length + 1;
      if (used + trendUsed + addLen + 40 > maxLen) {
        omittedTrends = trendParts.length - idx + 1;
        break;
      }
      trendLines.push(line);
      trendUsed += addLen;
      idx += 1;
    }
    if (trendLines.length > 1) {
      const trendSeg = trendLines.join('\n');
      parts.push(trendSeg);
      used += trendSeg.length + 2;
    }
  }

  const omitted: string[] = [];
  if (omittedItems > 0) omitted.push(`${omittedItems} 条情报`);
  if (omittedTrends > 0) omitted.push(`${omittedTrends} 条趋势观察`);
  if (omitted.length > 0) {
    parts.push(`（已按评分优先推送；因消息长度限制另有 ${omitted.join('、')}未展示，详见应用完整内容）`);
  }
  return parts.join('\n\n');
}
