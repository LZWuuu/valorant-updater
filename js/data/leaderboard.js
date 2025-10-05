// 排行榜数据管理模块
import { config } from '../config.js';
import { saveLeaderboardData } from '../api/github.js';

// 更新排行榜
export async function updateLeaderboard() {
  try {
    console.log("🏆 开始更新 leaderboard...");

    // 1. 加载当前的 leaderboard 数据
    let leaderboardData;
    try {
      const leaderboardRes = await fetch(`https://api.github.com/repos/${config.repo}/contents/src/leaderboard.json?ref=${config.branch}`, {
        headers: { "Authorization": `token ${config.token}` }
      });

      if (leaderboardRes.ok) {
        const leaderboardFile = await leaderboardRes.json();
        const decodedLeaderboardContent = atob(leaderboardFile.content.replace(/\s/g, ''));
        console.log("📄 leaderboard更新: 解码后的 leaderboard.json 内容长度:", decodedLeaderboardContent.length);

        if (decodedLeaderboardContent.trim() === '') {
          console.log("⚠️ leaderboard.json 文件为空，无法更新");
          return;
        }

        leaderboardData = JSON.parse(decodedLeaderboardContent);
        console.log("🏆 leaderboard更新: leaderboard.json 中有", leaderboardData.players?.length || 0, "个玩家");
      } else {
        console.log("leaderboard.json 不存在，使用默认数据");
        return;
      }
    } catch (error) {
      console.error("加载 leaderboard.json 失败:", error);
      return;
    }

    // 2. 加载 src/match/ 目录下的所有比赛文件
    let allMatches = [];
    try {
      // 清理配置值，确保没有多余的空格
      const cleanRepo = (config.repo || "Z0O-zw/valorant-updater").trim();
      const cleanBranch = (config.branch || "main").trim();

      // 使用数组 join 构建 URL，避免拼接错误
      const baseUrl = "https://api.github.com";
      const pathParts = ["repos", cleanRepo, "contents", "src", "match"];
      const apiUrl = `${baseUrl}/${pathParts.join("/")}?ref=${cleanBranch}`;

      console.log(`🔗 GitHub API URL: ${apiUrl}`);
      console.log(`📋 配置信息:`, {
        repo: cleanRepo,
        branch: cleanBranch,
        hasToken: !!config.token,
        urlLength: apiUrl.length,
        hasSpaces: apiUrl.includes(" ") || apiUrl.includes("%20%20")
      });

      // 验证 URL 是否正确
      if (apiUrl.includes(" ") || apiUrl.includes("%20%20")) {
        console.error("⚠️ URL 包含异常空格，可能导致请求失败");
      }

      const dirRes = await fetch(apiUrl, {
        headers: {
          "Authorization": `token ${config.token}`,
          "Accept": "application/vnd.github.v3+json"
        }
      });

      console.log(`📡 GitHub API 响应:`, {
        status: dirRes.status,
        statusText: dirRes.statusText,
        remaining: dirRes.headers.get('X-RateLimit-Remaining'),
        limit: dirRes.headers.get('X-RateLimit-Limit')
      });

      if (!dirRes.ok) {
        console.error(`❌ 无法读取 match 目录: ${dirRes.status} ${dirRes.statusText}`);
        const errorBody = await dirRes.text();
        console.error("错误详情:", errorBody);
        return;
      }

      const dirContent = await dirRes.json();
      console.log(`📁 找到 ${dirContent.length} 个文件/目录`);

      // 过滤出 JSON 文件
      const matchFiles = dirContent.filter(file =>
        file.type === 'file' &&
        file.name.endsWith('.json') &&
        file.name !== 'README.md'
      );

      console.log(`📊 找到 ${matchFiles.length} 个比赛文件`);

      // 串行读取每个比赛文件（避免并发请求过多）
      for (const fileInfo of matchFiles) {
        try {
          console.log(`📖 正在读取: ${fileInfo.name}`);
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
            console.log(`  ✅ 成功读取比赛: ${matchData.metadata?.matchid || fileInfo.name}`);
          } else {
            console.error(`  ❌ 无法读取文件 ${fileInfo.name}: ${fileRes.status}`);
          }

          // 添加小延迟，避免触发 API 速率限制
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          console.error(`  ❌ 读取文件 ${fileInfo.name} 失败:`, error);
        }
      }

      console.log(`✅ 成功加载 ${allMatches.length} 场比赛数据`);
    } catch (error) {
      console.error("加载比赛数据失败:", error);
      return;
    }

    // 3. 统计击杀数据
    console.log("📊 开始统计击杀数据...");

    // 初始化所有玩家的统计数据（保持原有字段结构）
    leaderboardData.players.forEach(player => {
      // 重置统计数据，保持原有字段名
      player.kills = 0;
      player.deaths = 0;
      player.assists = 0; // 重置助攻数据

      // 重置 killsAgainst 对象中的所有值（保持原有字段名）
      if (player.killsAgainst) {
        Object.keys(player.killsAgainst).forEach(puuid => {
          player.killsAgainst[puuid] = 0;
        });
      }
    });

    // 遍历所有比赛统计击杀
    allMatches.forEach(match => {
      if (!match.kills || !Array.isArray(match.kills)) {
        console.log(`⚠️ 比赛 ${match.metadata?.matchid} 没有击杀数据`);
        return;
      }

      match.kills.forEach(kill => {
        const killerPuuid = kill.killer_puuid;
        const victimPuuid = kill.victim_puuid;
        const assistants = kill.assistants || []; // 助攻者列表

        // 更新击杀者统计（使用原有字段名）
        const killer = leaderboardData.players.find(p => p.puuid === killerPuuid);
        if (killer) {
          killer.kills = (killer.kills || 0) + 1;

          // 更新对位击杀统计（使用原有字段名 killsAgainst）
          if (victimPuuid && victimPuuid !== killerPuuid) {
            if (!killer.killsAgainst) {
              killer.killsAgainst = {};
            }
            killer.killsAgainst[victimPuuid] = (killer.killsAgainst[victimPuuid] || 0) + 1;
          }
        }

        // 更新被击杀者统计（使用原有字段名）
        const victim = leaderboardData.players.find(p => p.puuid === victimPuuid);
        if (victim) {
          victim.deaths = (victim.deaths || 0) + 1;
        }

        // 更新助攻者统计
        assistants.forEach(assistant => {
          const assistantPuuid = assistant.assistant_puuid;
          if (assistantPuuid) {
            const assistantPlayer = leaderboardData.players.find(p => p.puuid === assistantPuuid);
            if (assistantPlayer) {
              assistantPlayer.assists = (assistantPlayer.assists || 0) + 1;
            }
          }
        });
      });
    });

    // 4. 输出统计结果
    console.log("📊 统计结果:");
    leaderboardData.players.forEach(player => {
      console.log(`  ${player.puuid}: ${player.kills} 击杀 / ${player.deaths} 死亡 / ${player.assists} 助攻`);
    });

    // 5. 保存更新后的 leaderboard 数据
    await saveLeaderboardData(leaderboardData);
    console.log("✅ leaderboard.json 更新完成");

  } catch (error) {
    console.error("❌ 更新 leaderboard 失败:", error);
    throw error;
  }
}