import { Skills } from '@/pages/Skills';
import { useTranslation } from 'react-i18next';

export function SkillsSection() {
  const { i18n } = useTranslation();
  const isZh = i18n.language?.startsWith('zh');

  return (
    <div className="p-8 space-y-4 max-w-2xl">
      <div>
        <h2 className="text-[13px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 px-1">
          {isZh ? '技能' : 'Skills'}
        </h2>
        <p className="text-[13px] text-muted-foreground px-1 mb-4">
          {isZh
            ? '技能为 AI 助手扩展额外能力，如网络搜索、图像生成、文档处理等。启用越多，每次对话消耗积分越多。'
            : 'Skills give your AI assistant extra abilities like web search, image generation, document processing, and more.'}
        </p>
      </div>
      <Skills />
    </div>
  );
}
