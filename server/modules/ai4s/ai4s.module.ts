import { Module } from '@nestjs/common';
import { Ai4sController } from './ai4s.controller';
import { Ai4sService } from './ai4s.service';
import { Ai4sIngestService } from './ai4s.ingest.service';
import { Ai4sPluginService } from './ai4s.plugins';
import { Ai4sAutomationTasksService } from './ai4s.automation';
import { Ai4sHealthChecker } from './ai4s.health.checker';
import { Ai4sHealthService } from './ai4s.health.service';
import { Ai4sWechatRssService } from './ai4s.wechat-rss.service';

@Module({
  controllers: [Ai4sController],
  providers: [
    Ai4sPluginService,
    Ai4sIngestService,
    Ai4sHealthChecker,
    Ai4sHealthService,
    Ai4sWechatRssService,
    Ai4sService,
    Ai4sAutomationTasksService,
  ],
  exports: [Ai4sService],
})
export class Ai4sModule {}
