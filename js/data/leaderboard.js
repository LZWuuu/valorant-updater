// 排行榜数据管理模块
import { config } from '../config.js';
import { saveLeaderboardData } from '../api/github.js';
import { perf } from '../utils/performance.js';

// 更新排行榜
export async function updateLeaderboard(shouldSave = true) {
  const mainKey = perf.start('排行榜更新', 'updateLeaderboard主函数');
  try {

    // 1. 加载当前的 leaderboard 数据
    const loadLeaderboardKey = perf.start('数据加载', '排行榜数据');
    let leaderboardData;
    try {
      const leaderboardRes = await fetch(`https://api.github.com/repos/${config.repo}/contents/src/leaderboard.json?ref=${config.branch}`, {
        headers: { "Authorization": `token ${config.token}` }
      });

      if (leaderboardRes.ok) {
        const leaderboardFile = await leaderboardRes.json();
        const decodedLeaderboardContent = atob(leaderboardFile.content.replace(/\s/g, ''));

        if (decodedLeaderboardContent.trim() === '') {
          return;
        }

        leaderboardData = JSON.parse(decodedLeaderboardContent);
      } else {
        perf.end(loadLeaderboardKey);
        return;
      }
    } catch (error) {
      console.error("加载 leaderboard.json 失败:", error);
      perf.end(loadLeaderboardKey);
      return;
    }
    perf.end(loadLeaderboardKey);

    // 2. 加载 src/match/ 目录下的所有比赛文件
    const loadMatchesKey = perf.start('数据加载', '所有比赛数据');
    let allMatches = [];
    try {
      // 清理配置值，确保没有多余的空格
      const cleanRepo = (config.repo || "Z0O-zw/valorant-updater").trim();
      const cleanBranch = (config.branch || "main").trim();

      // 使用数组 join 构建 URL，避免拼接错误
      const baseUrl = "https://api.github.com";
      const pathParts = ["repos", cleanRepo, "contents", "src", "match"];
      const apiUrl = `${baseUrl}/${pathParts.join("/")}?ref=${cleanBranch}`;


      // 验证 URL 是否正确
      if (apiUrl.includes(" ") || apiUrl.includes("%20%20")) {
        console.error("URL 包含异常空格，可能导致请求失败");
      }

      const dirRes = await fetch(apiUrl, {
        headers: {
          "Authorization": `token ${config.token}`,
          "Accept": "application/vnd.github.v3+json"
        }
      });


      if (!dirRes.ok) {
        console.error(`无法读取 match 目录: ${dirRes.status} ${dirRes.statusText}`);
        const errorBody = await dirRes.text();
        console.error("错误详情:", errorBody);
        return;
      }

      const dirContent = await dirRes.json();

      // 过滤出 JSON 文件
      const matchFiles = dirContent.filter(file =>
        file.type === 'file' &&
        file.name.endsWith('.json') &&
        file.name !== 'README.md'
      );


      // 串行读取每个比赛文件（避免并发请求过多）
      for (const fileInfo of matchFiles) {
        try {
          const fileRes = await fetch(fileInfo.url, {
            headers: {
              "Authorization": `token ${config.token}`,
              "Accept": "application/vnd.github.v3+json"
            }
          });

          if (fileRes.ok) {
            const fileData = await fileRes.json();
            const decodedContent = atob(fileData.content.replace(/\s/g, ''));
            const matchData = JSON.parse(decodedContent);
            allMatches.push(matchData);
          } else {
            console.error(`无法读取文件 ${fileInfo.name}: ${fileRes.status}`);
          }

          // 添加小延迟，避免触发 API 速率限制
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          console.error(`读取文件 ${fileInfo.name} 失败:`, error);
        }
      }

    } catch (error) {
      console.error("加载比赛数据失败:", error);
      perf.end(loadMatchesKey);
      return;
    }
    perf.end(loadMatchesKey);

    // 3. 统计击杀数据
    const statsKey = perf.start('数据计算', '统计计算');

    // 初始化所有玩家的统计数据（包含新字段）
    leaderboardData.players.forEach(player => {
      // 重置基础统计数据
      player.kills = 0;
      player.deaths = 0;
      player.assists = 0;

      // 重置命中部位统计
      player.bodyshots = 0;
      player.headshots = 0;
      player.legshots = 0;
      player.headrate = 0;

      // 重置胜负统计
      player.win = 0;
      player.all = 0;

      // 重置 killsAgainst 对象中的所有值
      if (player.killsAgainst) {
        Object.keys(player.killsAgainst).forEach(puuid => {
          player.killsAgainst[puuid] = 0;
        });
      }

      // 重置 assistsWith 对象中的所有值
      if (player.assistsWith) {
        Object.keys(player.assistsWith).forEach(puuid => {
          player.assistsWith[puuid] = 0;
        });
      }
    });

    // 遍历所有比赛统计数据

    allMatches.forEach(match => {
      const matchId = match.metadata?.matchid;

      // 1. 从 players.all_players.stats 统计基础数据
      if (match.players && match.players.all_players) {
        match.players.all_players.forEach(player => {
          const playerPuuid = player.puuid;
          const stats = player.stats || {};

          const leaderboardPlayer = leaderboardData.players.find(p => p.puuid === playerPuuid);
          if (leaderboardPlayer) {
            // 累加基础统计数据
            leaderboardPlayer.kills += (stats.kills || 0);
            leaderboardPlayer.deaths += (stats.deaths || 0);
            leaderboardPlayer.assists += (stats.assists || 0);
            leaderboardPlayer.bodyshots += (stats.bodyshots || 0);
            leaderboardPlayer.headshots += (stats.headshots || 0);
            leaderboardPlayer.legshots += (stats.legshots || 0);

          }
        });
      } else {
      }
    });

    // 遍历所有比赛统计 killsAgainst 和 assistsWith（从 kills 事件）

    let totalKillEvents = 0;
    let validKillEvents = 0;
    let outsiderKills = 0;
    let suicides = 0;

    allMatches.forEach(match => {
      if (!match.kills || !Array.isArray(match.kills)) {
        return;
      }

      match.kills.forEach(kill => {
        totalKillEvents++;
        const killerPuuid = kill.killer_puuid;
        const victimPuuid = kill.victim_puuid;
        const assistants = kill.assistants || [];

        const killerInList = leaderboardData.players.find(p => p.puuid === killerPuuid);
        const victimInList = leaderboardData.players.find(p => p.puuid === victimPuuid);

        if (killerInList) {
          if (killerPuuid === victimPuuid) {
            suicides++;
          } else {
            validKillEvents++;
            if (!victimInList) {
              outsiderKills++;
            }

            // 更新 killsAgainst 统计（排除自杀）
            if (victimPuuid && victimInList) {
              if (!killerInList.killsAgainst) {
                killerInList.killsAgainst = {};
              }
              killerInList.killsAgainst[victimPuuid] = (killerInList.killsAgainst[victimPuuid] || 0) + 1;
            }
          }
        }

        // 更新 assistsWith 统计
        assistants.forEach(assistant => {
          const assistantPuuid = assistant.assistant_puuid;
          if (assistantPuuid && killerPuuid !== assistantPuuid) {
            const assistantPlayer = leaderboardData.players.find(p => p.puuid === assistantPuuid);
            const killerPlayer = leaderboardData.players.find(p => p.puuid === killerPuuid);

            if (assistantPlayer && killerPlayer) {
              if (!assistantPlayer.assistsWith) {
                assistantPlayer.assistsWith = {};
              }
              assistantPlayer.assistsWith[killerPuuid] = (assistantPlayer.assistsWith[killerPuuid] || 0) + 1;
            }
          }
        });
      });
    });

    // 输出击杀事件统计（调试用）
    // console.log(`总击杀事件: ${totalKillEvents}, 有效击杀事件: ${validKillEvents}, 自杀事件: ${suicides}, 击杀局外人: ${outsiderKills}`);

    // 4. 统计胜负场次

    const excludedMatchId = "98cce6af-a308-4f13-ad8e-b3362af0ac05";

    allMatches.forEach(match => {
      const matchId = match.metadata?.matchid;

      // 排除特定的比赛
      if (matchId === excludedMatchId) {
        return;
      }


      // 获取队伍胜负信息
      const redWon = match.teams?.red?.has_won === true;
      const blueWon = match.teams?.blue?.has_won === true;

      if (!redWon && !blueWon) {
        return;
      }

      // 统计每个玩家的胜负
      if (match.players && match.players.all_players) {
        match.players.all_players.forEach(player => {
          const playerPuuid = player.puuid;
          const playerTeam = player.team; // "Red" 或 "Blue"

          const leaderboardPlayer = leaderboardData.players.find(p => p.puuid === playerPuuid);
          if (leaderboardPlayer) {
            // 增加总场次
            leaderboardPlayer.all += 1;

            // 判断是否获胜
            const playerWon = (playerTeam === "Red" && redWon) || (playerTeam === "Blue" && blueWon);
            if (playerWon) {
              leaderboardPlayer.win += 1;
            }

          }
        });
      }
    });

    // 5. 计算爆头率
    leaderboardData.players.forEach(player => {
      const totalShots = player.headshots + player.bodyshots + player.legshots;
      if (totalShots > 0) {
        player.headrate = Math.round((player.headshots / totalShots) * 1000) / 10; // 保留一位小数
      } else {
        player.headrate = 0;
      }
    });

    // 6. 验证统计结果
    leaderboardData.players.forEach(player => {
      const killsAgainstSum = Object.values(player.killsAgainst || {}).reduce((sum, kills) => sum + kills, 0);
      const difference = player.kills - killsAgainstSum;

      if (difference !== 0) {
        console.warn(`击杀统计不一致！总击杀(${player.kills}) != killsAgainst总和(${killsAgainstSum})`);
      }
    });
    perf.end(statsKey);

    // 7. 保存更新后的 leaderboard 数据（可选）
    if (shouldSave) {
      await saveLeaderboardData(leaderboardData);
    }

    // 返回更新后的数据
    perf.end(mainKey);
    return leaderboardData;

  } catch (error) {
    console.error("更新 leaderboard 失败:", error);
    perf.end(mainKey);
    throw error;
  }
}