import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { GeneralSection } from './sections/GeneralSection';
import { ModelsSection } from './sections/ModelsSection';
import { WorkspaceSection } from './sections/WorkspaceSection';
import { SkillsSection } from './sections/SkillsSection';
import { ChannelsSection } from './sections/ChannelsSection';
import { UsageSection } from './sections/UsageSection';
import { AboutSection } from './sections/AboutSection';
import { McpSection } from './sections/PlaceholderSections';
import { PrivacySection } from './sections/PrivacySection';
import { FeedbackSection } from './sections/FeedbackSection';
import { PointsSection } from './sections/PointsSection';

type SectionKey =
  | 'general' | 'usage' | 'points' | 'models' | 'mcp'
  | 'skills' | 'channels' | 'workspace' | 'privacy' | 'feedback' | 'about';

interface NavItem {
  key: SectionKey;
  zh: string;
  en: string;
}

const NAV_MAIN: NavItem[] = [
  { key: 'general',   zh: '通用',       en: 'General' },
  { key: 'usage',     zh: '用量统计',   en: 'Usage' },
  { key: 'points',    zh: '积分详情',   en: 'Points' },
  { key: 'models',    zh: '模型与 API', en: 'Models & API' },
  // { key: 'mcp',       zh: 'MCP 服务',   en: 'MCP Servers' },
  { key: 'skills',    zh: '技能',       en: 'Skills' },
  { key: 'channels',  zh: 'IM 频道',    en: 'IM Channels' },
  { key: 'workspace', zh: '工作区',     en: 'Workspace' },
  { key: 'privacy',   zh: '数据与隐私', en: 'Data & Privacy' },
  { key: 'feedback',  zh: '提交反馈',   en: 'Send Feedback' },
  { key: 'about',     zh: '关于',       en: 'About' },
];

function renderSection(key: SectionKey) {
  switch (key) {
    case 'general':   return <GeneralSection />;
    case 'models':    return <ModelsSection />;
    case 'workspace': return <WorkspaceSection />;
    case 'skills':    return <SkillsSection />;
    case 'mcp':       return <McpSection />;
    case 'channels':  return <ChannelsSection />;
    case 'usage':     return <UsageSection />;
    case 'points':    return <PointsSection />;
    case 'privacy':   return <PrivacySection />;
    case 'feedback':  return <FeedbackSection />;
    case 'about':     return <AboutSection />;
  }
}

export function Preferences() {
  const { i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');
  const [active, setActive] = useState<SectionKey>('general');

  const label = (item: NavItem) => isZh ? item.zh : item.en;

  return (
    <div className="flex -m-6 dark:bg-background h-[calc(100vh-2.5rem)] overflow-hidden">
      {/* ── Left sidebar ── */}
      <div className="w-[180px] shrink-0 border-r border-black/5 dark:border-white/5 flex flex-col py-4 px-2 overflow-y-auto bg-black/[0.02] dark:bg-white/[0.02]">
        {NAV_MAIN.map((item) => (
          <button
            key={item.key}
            onClick={() => setActive(item.key)}
            className={cn(
              'flex items-center px-3 py-[7px] rounded-lg text-[13px] transition-colors text-left w-full mb-0.5',
              active === item.key
                ? 'bg-black/8 dark:bg-white/10 text-foreground font-medium'
                : 'text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5 hover:text-foreground'
            )}
          >
            {label(item)}
          </button>
        ))}
      </div>

      {/* ── Right content ── */}
      <div className="flex-1 overflow-y-auto">
        {renderSection(active)}
      </div>
    </div>
  );
}
