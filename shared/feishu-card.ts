/**
 * AI4S 情报雷达 — 飞书卡片渲染
 *
 * 两种输出：
 *  1. buildFeishuCardElements — 飞书 interactive card 的 elements 数组
 *     （text 元素居中 + hr 分割线 + markdown 正文，用于 Webhook 直推）
 *  2. renderFeishuMarkdown — 纯 Markdown 字符串（用于只能传 content 字符串的插件接口，
 *     飞书 Markdown 不支持 <div align>，用空格填充近似居中效果）
 */
import { parseDigest, type DigestBlock } from './digest';

const SPACE_FILL_CHAR = '　'; // 全角空格，飞书 Markdown 中宽度稳定

function padCenter(text: string, totalWidth: number): string {
  const len = [...text].length;
  if (len >= totalWidth) return text;
  const pad = totalWidth - len;
  const left = Math.floor(pad / 2);
  return SPACE_FILL_CHAR.repeat(left) + text;
}

function blockTitleMarkdown(title: string): string {
  return `**${padCenter(title, 20)}**`;
}

function categoryTitleMarkdown(name: string): string {
  return `<font color='blue'>**${padCenter(name, 18)}**</font>`;
}

function itemMarkdown(item: { source: string; score: string; summary: string; links: string[] }): string {
  const lines: string[] = [`**${item.source}** 评分：<font color='green'>${item.score}</font>`];
  if (item.summary) lines.push(item.summary);
  for (const link of item.links) {
    lines.push(`**原文链接：**[${link}](${link})`);
  }
  return lines.join('\n');
}

interface FeishuCardElement {
  tag: string;
  content?: string;
  text_align?: string;
  text_size?: string;
  color?: string;
}

function textElement(
  content: string,
  options: { align?: string; size?: string; color?: string } = {},
): FeishuCardElement {
  const { align = 'left', size = 'normal', color } = options;
  const el: FeishuCardElement = { tag: 'text', content, text_align: align, text_size: size };
  if (color) el.color = color;
  return el;
}

function hrElement(): FeishuCardElement {
  return { tag: 'hr' };
}

export function buildFeishuCardElements(content: string): FeishuCardElement[] {
  const blocks = parseDigest(content);
  if (!blocks) return [{ tag: 'markdown', content }];
  const elements: FeishuCardElement[] = [];
  for (let bi = 0; bi < blocks.length; bi += 1) {
    const block = blocks[bi];
    if (bi > 0) elements.push(hrElement());
    elements.push(textElement(block.title, { align: 'center', size: 'heading' }));
    let firstCat = true;
    for (const cat of block.categories) {
      if (!firstCat) elements.push(hrElement());
      firstCat = false;
      if (cat.name) {
        elements.push(textElement(cat.name, { align: 'center', size: 'heading', color: 'blue' }));
      }
      let firstItem = true;
      for (const item of cat.items) {
        if (!firstItem) elements.push(hrElement());
        firstItem = false;
        elements.push({ tag: 'markdown', content: itemMarkdown(item) });
      }
    }
    if (block.trends.length > 0) {
      if (!firstCat) elements.push(hrElement());
      elements.push(textElement('趋势观察', { align: 'center', size: 'heading', color: 'blue' }));
      const lines: string[] = [];
      for (let i = 0; i < block.trends.length; i += 1) {
        lines.push(`**${i + 1}.** ${block.trends[i]}`);
      }
      elements.push({ tag: 'markdown', content: lines.join('\n') });
    }
  }
  return elements;
}

export function renderFeishuMarkdown(content: string): string {
  const blocks = parseDigest(content);
  if (!blocks) return content;
  const sections: string[] = [];
  for (const block of blocks) {
    const blockParts: string[] = [blockTitleMarkdown(block.title)];
    const catBlocks: string[] = [];
    for (const cat of block.categories) {
      const catParts: string[] = [];
      if (cat.name) catParts.push(categoryTitleMarkdown(cat.name));
      const itemChunks: string[] = [];
      for (const item of cat.items) {
        itemChunks.push(itemMarkdown(item));
      }
      catParts.push(itemChunks.join('\n---\n'));
      catBlocks.push(catParts.join('\n'));
    }
    blockParts.push(catBlocks.join('\n'));
    if (block.trends.length > 0) {
      const trendLines: string[] = [categoryTitleMarkdown('趋势观察')];
      for (let i = 0; i < block.trends.length; i += 1) {
        trendLines.push(`**${i + 1}.** ${block.trends[i]}`);
      }
      blockParts.push(trendLines.join('\n'));
    }
    sections.push(blockParts.join('\n'));
  }
  return sections.join('\n\n');
}

export function renderFeishuMarkdownBudget(content: string, maxLen: number): string {
  const full = renderFeishuMarkdown(content);
  if (full.length <= maxLen) return full;

  const blocks = parseDigest(content);
  if (!blocks) return content.slice(0, maxLen);

  const entries: { blockTitle: string; catName: string; item: { source: string; score: string; summary: string; links: string[] } }[] = [];
  const trends: string[] = [];
  for (const block of blocks) {
    for (const cat of block.categories) {
      for (const item of cat.items) {
        entries.push({ blockTitle: block.title, catName: cat.name, item });
      }
    }
    for (const t of block.trends) trends.push(t);
  }
  entries.sort((a, b) => {
    const sa = Number(a.item.score.replace(/[^\d.]/g, '')) || 0;
    const sb = Number(b.item.score.replace(/[^\d.]/g, '')) || 0;
    return sb - sa;
  });

  const parts: string[] = [];
  let used = 0;
  let lastBlock = '';
  let lastCat = '';
  let omittedItems = 0;
  for (const e of entries) {
    const body = itemMarkdown(e.item);
    const prefix: string[] = [];
    if (e.blockTitle !== lastBlock) {
      prefix.push(blockTitleMarkdown(e.blockTitle));
      lastCat = '';
    }
    if (e.catName && e.catName !== lastCat) prefix.push(categoryTitleMarkdown(e.catName));
    const seg = [...prefix, body].join('\n');
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
  if (trends.length > 0 && used + 20 <= maxLen) {
    const trendLines: string[] = [categoryTitleMarkdown('趋势观察')];
    let trendUsed = trendLines[0].length;
    for (let i = 0; i < trends.length; i += 1) {
      const line = `**${i + 1}.** ${trends[i]}`;
      const addLen = line.length + 1;
      if (used + trendUsed + addLen + 40 > maxLen) {
        omittedTrends = trends.length - i;
        break;
      }
      trendLines.push(line);
      trendUsed += addLen;
    }
    if (trendLines.length > 1) {
      const seg = trendLines.join('\n');
      parts.push(seg);
      used += seg.length + 2;
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

export { DigestBlock };
