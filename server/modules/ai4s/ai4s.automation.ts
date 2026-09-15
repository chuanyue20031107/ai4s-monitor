/**
 * AI4S 情报雷达 — 自动化任务（绑定 daily_ai4s_digest 触发器）
 * 触发器每 30 分钟轮询一次；执行时读取数据库设置判断：
 *   1. 每日开关（dailyCrawlEnabled / dailyPushEnabled）
 *   2. 是否命中配置的推送时间（pushTime，半小时粒度）
 *   3. 今天是否已执行过（lastRunAt，防重复）
 */
import { Injectable, Logger } from '@nestjs/common';
import { Automation, BindTrigger } from '@lark-apaas/fullstack-nestjs-core';
import { Ai4sService } from './ai4s.service';

interface ShanghaiNow {
  hour: number;
  minute: number;
  dateKey: string;
}

function shanghaiNow(): ShanghaiNow {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date());
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return {
    hour: Number(map.hour === '24' ? '0' : map.hour),
    minute: Number(map.minute),
    dateKey: `${map.year}-${map.month}-${map.day}`,
  };
}

function shanghaiDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

@Automation()
@Injectable()
export class Ai4sAutomationTasksService {
  private readonly logger = new Logger(Ai4sAutomationTasksService.name);

  constructor(private readonly ai4sService: Ai4sService) {}

  /** 判断当前轮询是否命中每日执行条件（推送时间 + 当天未执行） */
  private shouldRunNow(pushTime: string, lastRunAt: Date | null): boolean {
    const now = shanghaiNow();
    const [h, m] = pushTime.split(':').map(Number);
    const slotMinute = Math.floor(now.minute / 30) * 30;
    const hitPushTime = now.hour === h && slotMinute === m;
    if (!hitPushTime) {
      return false;
    }
    if (lastRunAt && shanghaiDateKey(lastRunAt) === now.dateKey) {
      return false;
    }
    return true;
  }

  @BindTrigger('daily_ai4s_digest')
  async dailyAi4sDigest(): Promise<void> {
    try {
      const settings = await this.ai4sService.getSettings();
      if (!settings.dailyCrawlEnabled && !settings.dailyPushEnabled) {
        this.logger.log('每日抓取与推送均已关闭，本轮跳过');
        return;
      }
      const lastRunAt = settings.lastRunAt ? new Date(settings.lastRunAt) : null;
      if (!this.shouldRunNow(settings.pushTime, lastRunAt)) {
        this.logger.log(
          `未命中执行时间（配置推送时间 ${settings.pushTime}，当前上海时间 ${shanghaiNow().hour}:${String(shanghaiNow().minute).padStart(2, '0')}），本轮跳过`,
        );
        return;
      }
      this.logger.log('命中每日执行窗口，开始运行完整监控链路');
      const result = await this.ai4sService.runDailyTask();
      this.logger.log(
        `每日任务完成：来源成功 ${result.sourcesSucceeded}/${result.sourcesTotal}，失败 ${result.sourcesFailed}，` +
          `新增 ${result.articlesInserted} 篇，分析成功 ${result.articlesAnalyzed} 篇，` +
          `摘要 ${result.digestGenerated ? '已生成' : '未生成'}，推送 ${result.pushed ? '成功' : result.pushMessage || '未执行'}`,
      );
    } catch (error) {
      this.logger.error(`daily_ai4s_digest 任务执行失败: ${String(error)}`);
    }
  }
}
