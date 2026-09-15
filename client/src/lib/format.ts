import { format } from 'date-fns';

/** 时间戳 → 'yyyy-MM-dd HH:mm'，空值返回 '—' */
export function formatDateTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  return format(new Date(ts), 'yyyy-MM-dd HH:mm');
}

/** 时间戳 → 'MM-dd HH:mm'（紧凑版，表格用） */
export function formatShortDateTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  return format(new Date(ts), 'MM-dd HH:mm');
}

/** 今天 00:00 的时间戳 */
export function todayStartTs(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 'yyyy-MM-dd' 字符串 → 当天 00:00 时间戳；空串返回 null */
export function dateStrToTs(dateStr: string, endOfDay = false): number | null {
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  return d.getTime();
}
