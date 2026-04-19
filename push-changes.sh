#!/bin/bash
# OKR Navigator — 推送 UI 改善修改
cd "$(dirname "$0")"
rm -f .git/index.lock
git add app/okr/page.tsx app/page.tsx app/settings/page.tsx components/BottomNav.tsx
git commit -m "Fix UI issues: progress colors, progress bar, dashboard stats, settings labels, nav names, sort button, confidence buttons

- Progress color: gray(<30%), amber(30-59%), green(>=60%), red only when overdue
- Dashboard: stats cards now show count + completion% separately
- Settings: AI model labels now user-friendly (快速/均衡/深度分析模式)
- BottomNav: unified with sidebar labels (Dashboard/OKR目標/新增Idea)
- Ideas sort buttons hidden when list is empty
- Confidence selector: button group with visual active state

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
git push
echo "✅ 推送完成！請前往 Vercel 查看部署狀態。"
