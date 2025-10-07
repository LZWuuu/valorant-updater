// 用户数据管理模块
import { config } from '../config.js';
import { saveUserData, saveMatchFile, commitMultipleFiles } from '../api/github.js';
import { fetchMatchList } from '../api/henrik.js';
import { updateLeaderboard } from './leaderboard.js';
import { showLoadingIndicator, showErrorMessage } from '../ui/common.js';
import { perf } from '../utils/performance.js';

// 更新用户数据
export async function updateUserData() {
  const mainKey = perf.start('用户数据更新', 'updateUserData主函数');
  let hasNewMatches = false;
  let updatedLeaderboardData = null;

  try {
    showLoadingIndicator(true);

    // 1. 加载当前的用户数据（移除了目录检查以减少一次GitHub读取）
    const loadUserKey = perf.start('数据加载', '用户数据');
    let userJson, userData;
    try {
      const userUrl = `https://api.github.com/repos/${config.repo}/contents/${config.userDataPath}?ref=${config.branch}`;
      console.log('🔍 [DEBUG] 开始加载用户数据:', {
        url: userUrl,
        repo: config.repo,
        branch: config.branch,
        userDataPath: config.userDataPath,
        hasToken: !!config.token,
        tokenPrefix: config.token ? config.token.substring(0, 10) + '...' : 'NO_TOKEN'
      });

      const userRes = await fetch(userUrl, {
        headers: { "Authorization": `token ${config.token}` }
      });

      console.log('📥 [DEBUG] 用户数据请求响应:', {
        status: userRes.status,
        statusText: userRes.statusText,
        ok: userRes.ok,
        headers: Object.fromEntries(userRes.headers.entries())
      });

      if (userRes.ok) {
        userData = await userRes.json();
        const decodedUserContent = atob(userData.content.replace(/\s/g, ''));

        console.log('✅ [DEBUG] 用户数据解析成功:', {
          sha: userData.sha,
          contentLength: decodedUserContent.length,
          isEmpty: decodedUserContent.trim() === ''
        });

        if (decodedUserContent.trim() === '') {
          showLoadingIndicator(false);
          showErrorMessage("user.json 文件为空，请检查数据");
          return;
        }

        userJson = JSON.parse(decodedUserContent);
        console.log('📊 [DEBUG] 当前用户数据:', {
          playersCount: userJson.players?.length || 0,
          newestMatchID: userJson.newestMatchID,
          playerNames: userJson.players?.map(p => p.name) || []
        });
      } else {
        console.log('⚠️ [DEBUG] 用户数据文件不存在，使用默认数据');
        userJson = { players: [], newestMatchID: null };
        userData = { sha: null };
      }
    } catch (error) {
      console.error("❌ [DEBUG] 加载 user.json 失败:", error);
      perf.end(loadUserKey);
      showLoadingIndicator(false);
      showErrorMessage("加载用户数据失败");
      return;
    }
    perf.end(loadUserKey);

    // 3. 获取最新的比赛数据
    const fetchMatchKey = perf.start('数据获取', 'Henrik API比赛数据');
    let matchData;
    try {
      console.log('🎮 [DEBUG] 开始获取Henrik API比赛数据...');
      matchData = await fetchMatchList();
      console.log('📡 [DEBUG] Henrik API响应:', {
        hasData: !!matchData,
        dataLength: matchData?.data?.length || 0,
        firstMatchId: matchData?.data?.[0]?.metadata?.matchid || 'N/A',
        firstMatchMode: matchData?.data?.[0]?.metadata?.mode || 'N/A'
      });
      perf.end(fetchMatchKey);
    } catch (error) {
      console.error("❌ [DEBUG] 获取比赛数据失败:", error);
      perf.end(fetchMatchKey);
      showLoadingIndicator(false);
      showErrorMessage("获取比赛数据失败，请检查网络连接");
      return;
    }

    if (!matchData || !matchData.data || !Array.isArray(matchData.data)) {
      console.error("❌ [DEBUG] 比赛数据格式错误:", matchData);
      showLoadingIndicator(false);
      showErrorMessage("比赛数据格式错误");
      return;
    }

    console.log('🔍 [DEBUG] 开始筛选custom比赛，总数据:', {
      totalMatches: matchData.data.length,
      userPlayersCount: userJson.players.length,
      userPlayerNames: userJson.players.map(p => p.name)
    });

    // 4. 处理比赛数据
    const customMatches = matchData.data.filter(match => {
      const mode = match?.metadata?.mode;
      const modeId = match?.metadata?.mode_id;

      // 首先检查 mode 是否为 custom
      const isCustomMode = (mode === "custom" || mode === "Custom" ||
                           modeId === "custom" || modeId === "Custom" ||
                           mode?.toLowerCase() === "custom" ||
                           modeId?.toLowerCase() === "custom");

      if (!isCustomMode) {
        return false;
      }

      // 获取比赛中的玩家
      const matchPlayers = match.players?.all_players || [];
      const matchPlayerPuuids = matchPlayers.map(p => p.puuid);

      // 获取user.json中的玩家puuid列表
      const userPlayerPuuids = userJson.players.map(p => p.puuid);

      // 检查所有比赛玩家是否都在user.json的8个人中
      const allPlayersInUserList = matchPlayerPuuids.every(puuid => userPlayerPuuids.includes(puuid));

      if (!allPlayersInUserList) {
        return false;
      }

      // 支持8人比赛（原逻辑）和6人比赛（新增）
      const playerCount = matchPlayerPuuids.length;
      const isValidPlayerCount = playerCount === 8 || playerCount === 6;

      // 如果是6人比赛，记录日志
      if (playerCount === 6 && isValidPlayerCount) {
        console.log(`✅ 发现6人custom比赛: ${match.metadata?.matchid}`);
      }

      return isValidPlayerCount;
    });

    console.log(`🎯 [DEBUG] 比赛筛选结果: 总共${matchData.data.length}场比赛，筛选出${customMatches.length}场custom比赛`);

    if (customMatches.length > 0) {
      // 统计筛选出的比赛信息
      const matchStats = customMatches.map(match => ({
        matchId: match.metadata?.matchid,
        playerCount: match.players?.all_players?.length || 0,
        mode: match.metadata?.mode,
        gameStartTime: match.metadata?.game_start_patched
      }));
      console.log('📋 [DEBUG] 筛选出的比赛详情:', matchStats);
      const latestMatch = customMatches[0];
      const latestMatchId = latestMatch.metadata?.matchid;
      const matchPlayers = latestMatch.players?.all_players || [];

      console.log('🔍 [DEBUG] 检查是否有新比赛:', {
        latestMatchIdFromAPI: latestMatchId,
        currentNewestMatchID: userJson.newestMatchID,
        hasNewMatches: latestMatchId !== userJson.newestMatchID
      });

      // 需要执行的操作列表
      const promises = [];

      // 4.1 检查并准备用户数据更新
      if (latestMatchId === userJson.newestMatchID) {
        console.log('ℹ️ [DEBUG] 没有新比赛，检查是否需要补充保存历史比赛文件...');

        // 即使没有新比赛，也检查是否需要补充保存历史比赛文件
        let missingMatches = [];

        for (const match of customMatches) {
          const matchId = match.metadata?.matchid;
          if (matchId) {
            // 检查该比赛文件是否已存在
            try {
              const matchPath = `src/match/${matchId}.json`;
              const checkRes = await fetch(`https://api.github.com/repos/${config.repo}/contents/${matchPath}?ref=${config.branch}`, {
                headers: { "Authorization": `token ${config.token}` }
              });

              if (!checkRes.ok) {
                missingMatches.push(match);
              }
            } catch (error) {
              missingMatches.push(match);
            }
          }
        }

        if (missingMatches.length > 0) {
          const saveMatchesKey = perf.start('文件批量处理', `保存${missingMatches.length}个比赛文件`);

          // 保存缺失的比赛文件
          for (const match of missingMatches) {
            const matchId = match.metadata.matchid;
            const matchPath = `src/match/${matchId}.json`;

            try {
              await saveMatchFile(match, matchPath);
            } catch (err) {
              console.error(`补充保存比赛 ${matchId} 失败:`, err);
            }
          }
          perf.end(saveMatchesKey);

          // 补充保存后更新 newestMatchID
          try {
            await saveUserData(userJson, userData.sha);
          } catch (error) {
            console.error("更新 newestMatchID 失败:", error);
          }

          // 补充保存后更新 leaderboard
          try {
            updatedLeaderboardData = await updateLeaderboard();
          } catch (error) {
            console.error("更新 leaderboard 失败:", error);
          }
        } else {

          // 检查 leaderboard 是否需要初始化
          try {
            const leaderboardRes = await fetch(`https://api.github.com/repos/${config.repo}/contents/src/leaderboard.json?ref=${config.branch}`, {
              headers: { "Authorization": `token ${config.token}` }
            });

            if (leaderboardRes.ok) {
              const leaderboardFile = await leaderboardRes.json();
              const content = atob(leaderboardFile.content.replace(/\s/g, ''));

              let needsUpdate = false;
              try {
                const leaderboardData = JSON.parse(content);

                if (!leaderboardData.players || leaderboardData.players.length === 0) {
                  needsUpdate = true;
                } else {
                  const uninitializedPlayers = leaderboardData.players.filter(player => {
                    const hasNoStats = (player.kills === 0 || player.kills === undefined) &&
                                      (player.deaths === 0 || player.deaths === undefined);
                    const hasNoKillsAgainst = !player.killsAgainst || Object.keys(player.killsAgainst).length === 0;
                    return hasNoStats && hasNoKillsAgainst;
                  });

                  if (uninitializedPlayers.length > 0) {
                    needsUpdate = true;
                  }
                }

                if (needsUpdate) {
                  try {
                    await updateLeaderboard();
                  } catch (error) {
                    console.error("初始化 leaderboard 失败:", error);
                  }
                } else {
                }
              } catch (parseError) {
                try {
                  await updateLeaderboard();
                } catch (error) {
                  console.error("重新初始化 leaderboard 失败:", error);
                }
              }
            } else {
              try {
                await updateLeaderboard();
              } catch (error) {
                console.error("创建 leaderboard 失败:", error);
              }
            }
          } catch (error) {
          }
        }
      } else {
        hasNewMatches = true;
        console.log('🆕 [DEBUG] 发现新比赛！开始处理...');

        // 找出需要保存的新比赛
        const newCustomMatches = [];
        for (const match of customMatches) {
          if (match.metadata?.matchid === userJson.newestMatchID) {
            console.log(`🔍 [DEBUG] 找到分界点，停止收集新比赛: ${match.metadata?.matchid}`);
            break;
          }
          newCustomMatches.push(match);
        }

        console.log(`🆕 [DEBUG] 新增比赛数量: ${newCustomMatches.length}`, {
          newMatchIds: newCustomMatches.map(m => m.metadata?.matchid),
          oldNewestMatchID: userJson.newestMatchID,
          newNewestMatchID: latestMatchId
        });

        // 更新用户信息
        const updateUserInfoKey = perf.start('数据处理', '更新用户信息');
        let updatedCount = 0;
        userJson.players = userJson.players.map(player => {
          const matchPlayer = matchPlayers.find(p => p.puuid === player.puuid);
          if (matchPlayer) {
            const oldInfo = { name: player.name, tag: player.tag, card: player.card };

            player.name = matchPlayer.name;
            player.tag = matchPlayer.tag;
            player.card = matchPlayer.assets?.card?.small || "";

            if (oldInfo.name !== player.name || oldInfo.tag !== player.tag || oldInfo.card !== player.card) {
              updatedCount++;
            }
          }
          return player;
        });
        perf.end(updateUserInfoKey);

        promises.push(
          saveUserData(userJson, userData.sha)
        );

        // 4.2 检查并准备比赛数据更新
        if (newCustomMatches.length > 0 || latestMatchId !== userJson.newestMatchID) {

          userJson.newestMatchID = latestMatchId;

          if (newCustomMatches.length > 0) {
            const batchUpdateKey = perf.start('批量更新', `user.json + ${newCustomMatches.length}个比赛文件 + leaderboard.json`);
            console.log('📦 [DEBUG] 开始准备批量提交文件...');

            try {
              // 1. 准备要批量提交的文件
              const filesToCommit = [];

              // 2. 准备user.json内容
              const userContent = JSON.stringify(userJson, null, 4);
              filesToCommit.push({
                path: config.userDataPath,
                content: userContent
              });
              console.log('📄 [DEBUG] 已准备user.json文件');

              // 3. 准备新比赛文件内容
              for (const match of newCustomMatches) {
                const matchId = match.metadata.matchid;
                const matchPath = `src/match/${matchId}.json`;

                // 复制match数据并删除rounds字段（节省空间）
                const matchDataCopy = { ...match };
                delete matchDataCopy.rounds;

                const matchContent = JSON.stringify(matchDataCopy, null, 4);
                filesToCommit.push({
                  path: matchPath,
                  content: matchContent
                });
                console.log(`🎮 [DEBUG] 已准备比赛文件: ${matchPath}`);
              }

              // 4. 计算并准备leaderboard.json内容
              console.log('📊 [DEBUG] 开始计算leaderboard数据...');
              // 先计算leaderboard数据（不保存到GitHub）
              updatedLeaderboardData = await updateLeaderboard(false); // false表示只计算不保存

              if (updatedLeaderboardData) {
                const leaderboardContent = JSON.stringify(updatedLeaderboardData, null, 4);
                filesToCommit.push({
                  path: 'src/leaderboard.json',
                  content: leaderboardContent
                });
                console.log('📊 [DEBUG] 已准备leaderboard.json文件');
              } else {
                console.log('⚠️ [DEBUG] leaderboard数据计算失败或为空');
              }

              console.log('🚀 [DEBUG] 准备批量提交文件:', {
                totalFiles: filesToCommit.length,
                filePaths: filesToCommit.map(f => f.path)
              });

              // 5. 批量提交所有文件
              const commitMessage = `Update match data: ${newCustomMatches.length} new matches`;
              console.log('⏳ [DEBUG] 开始批量提交到GitHub...');
              await commitMultipleFiles(filesToCommit, commitMessage);

              console.log('✅ [DEBUG] 成功批量更新:', {
                userJsonUpdated: true,
                newMatches: newCustomMatches.length,
                leaderboardUpdated: !!updatedLeaderboardData,
                totalFilesCommitted: filesToCommit.length
              });

            } catch (error) {
              console.error("❌ [DEBUG] 批量更新失败:", error);
              // 如果批量更新失败，回退到单独保存
              console.log("🔄 [DEBUG] 尝试单独保存...");

              try {
                await saveUserData(userJson, userData.sha);
                for (const match of newCustomMatches) {
                  const matchId = match.metadata.matchid;
                  const matchPath = `src/match/${matchId}.json`;
                  await saveMatchFile(match, matchPath);
                }
                updatedLeaderboardData = await updateLeaderboard();
              } catch (fallbackError) {
                console.error("单独保存也失败:", fallbackError);
              }
            }

            perf.end(batchUpdateKey);
          }
        } else {

          // 检查 leaderboard 是否需要初始化
          try {
            const leaderboardRes = await fetch(`https://api.github.com/repos/${config.repo}/contents/src/leaderboard.json?ref=${config.branch}`, {
              headers: { "Authorization": `token ${config.token}` }
            });

            if (leaderboardRes.ok) {
              const leaderboardFile = await leaderboardRes.json();
              const content = atob(leaderboardFile.content.replace(/\s/g, ''));

              let needsUpdate = false;
              try {
                const leaderboardData = JSON.parse(content);

                if (!leaderboardData.players || leaderboardData.players.length === 0) {
                  needsUpdate = true;
                } else {
                  const uninitializedPlayers = leaderboardData.players.filter(player => {
                    const hasNoStats = (player.kills === 0 || player.kills === undefined) &&
                                      (player.deaths === 0 || player.deaths === undefined);
                    const hasNoKillsAgainst = !player.killsAgainst || Object.keys(player.killsAgainst).length === 0;
                    return hasNoStats && hasNoKillsAgainst;
                  });

                  if (uninitializedPlayers.length > 0) {
                    needsUpdate = true;
                  }
                }

                if (needsUpdate) {
                  try {
                    await updateLeaderboard();
                  } catch (error) {
                    console.error("初始化 leaderboard 失败:", error);
                  }
                }
              } catch (parseError) {
                try {
                  await updateLeaderboard();
                } catch (error) {
                  console.error("初始化 leaderboard 失败:", error);
                }
              }
            } else {
            }
          } catch (error) {
          }
        }

        // 4.3 执行用户数据更新操作
        if (promises.length > 0) {
          await Promise.all(promises);
        } else {
        }
      }
    } else {
    }

  } catch (error) {
    console.error("更新用户数据时发生错误:", error);
    showErrorMessage("更新用户数据失败，请检查配置和网络连接");
    perf.end(mainKey);
  } finally {
    showLoadingIndicator(false);
  }

  perf.end(mainKey);
  return { hasNewMatches, updatedLeaderboardData };
}