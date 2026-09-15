import { format } from 'date-fns';
import { useLocation } from 'react-router-dom';
import { Separator } from '@/components/ui/separator';
import { SidebarTrigger } from '@/components/ui/sidebar';

const PAGE_TITLES: { prefix: string; title: string }[] = [
  { prefix: '/articles', title: '情报文章列表' },
  { prefix: '/sources', title: '监控来源管理' },
  { prefix: '/runs', title: '运行记录' },
  { prefix: '/settings', title: '设置' },
];

export default function Header() {
  const { pathname } = useLocation();
  const matched = PAGE_TITLES.find((p) => pathname.startsWith(p.prefix));
  const title = matched ? matched.title : 'AI4S 学术活动监控';

  return (
    <header className="sticky top-0 z-40 flex h-14 w-full items-center gap-2 border-b border-border/60 bg-background/80 px-4 backdrop-blur-md">
      <SidebarTrigger className="shrink-0" />
      <Separator orientation="vertical" className="hidden h-4 md:block" />
      <h1 className="truncate text-sm font-semibold">{title}</h1>
      <div className="ml-auto hidden text-xs text-muted-foreground md:block">
        专业科研情报工作台 · {format(new Date(), 'yyyy-MM-dd EEEE')}
      </div>
    </header>
  );
}
