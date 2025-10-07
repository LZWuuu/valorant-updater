// 主入口文件
import { loadConfig } from './config.js';
import { loadDataWithToken } from './api/github.js';
import { updateUserData } from './data/user.js';
import { updateLeaderboard } from './data/leaderboard.js';
import { setPlayers, setLeaderboardData } from './ui/players.js';
import { setMatches } from './data/match.js';
import { showTab } from './ui/common.js';
import { perf } from './utils/performance.js';

// 全局初始化函数
async function init() {
  const initKey = perf.start('应用初始化', '完整流程');

  try {

    // 1. 加载配置
    const configKey = perf.start('配置加载');
    console.log('🔧 [DEBUG] 开始加载配置...');
    await loadConfig();
    console.log('✅ [DEBUG] 配置加载完成');
    perf.end(configKey);

    // 2. 更新用户数据（包括 leaderboard）
    const updateKey = perf.start('用户数据更新');
    console.log('🔄 [DEBUG] 开始更新用户数据...');
    const updateResult = await updateUserData();
    console.log('📊 [DEBUG] 用户数据更新完成:', updateResult);
    perf.end(updateKey);

    // 3. 加载数据（如果刚更新过，延迟一下避免缓存问题）
    if (updateResult && updateResult.hasNewMatches) {
      const delayKey = perf.start('数据同步等待', '2秒延迟');
      await new Promise(resolve => setTimeout(resolve, 2000)); // 等待2秒
      perf.end(delayKey);
    }

    // 4. 加载现有数据
    const loadKey = perf.start('GitHub数据加载');
    const data = await loadDataWithToken();
    perf.end(loadKey);

    const uiKey = perf.start('UI数据设置');

    // 如果刚更新了用户数据，使用更新后的数据；否则使用从 GitHub 加载的数据
    if (updateResult && updateResult.updatedUserData) {
      console.log('🔄 [DEBUG] 使用更新后的用户数据');
      setPlayers(updateResult.updatedUserData.players);
    } else {
      console.log('📥 [DEBUG] 使用从GitHub加载的用户数据');
      setPlayers(data.players);
    }

    setMatches(data.matches);

    // 始终重新计算排行榜数据以确保显示最新结果
    console.log('📊 [DEBUG] 重新计算排行榜数据...');
    const leaderboardKey = perf.start('排行榜重计算');
    const freshLeaderboardData = await updateLeaderboard(false); // false表示只计算不保存
    if (freshLeaderboardData) {
      setLeaderboardData(freshLeaderboardData);
      console.log('✅ [DEBUG] 排行榜数据已更新');
    } else {
      console.log('⚠️ [DEBUG] 排行榜计算失败，使用缓存数据');
      if (updateResult && updateResult.updatedLeaderboardData) {
        setLeaderboardData(updateResult.updatedLeaderboardData);
      } else {
        setLeaderboardData(data.leaderboard);
      }
    }
    perf.end(leaderboardKey);
    perf.end(uiKey);

    // 5. 显示默认标签页
    const renderKey = perf.start('页面渲染');
    showTab('match');
    perf.end(renderKey);

    perf.end(initKey);

    // 生成性能报告
    setTimeout(() => perf.generateReport(), 100);

  } catch (error) {
    perf.end(initKey);
    console.error('应用初始化失败:', error);
  }
}

// DOM 加载完成后初始化
document.addEventListener('DOMContentLoaded', init);

// 导出 showTab 给全局使用
if (typeof window !== 'undefined') {
  window.showTab = showTab;
}