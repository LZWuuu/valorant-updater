// GitHub API 操作模块
import { config } from '../config.js';
import { perf } from '../utils/performance.js';

// 从 GitHub 读取用户数据
export async function loadUserData() {
  const key = perf.start('GitHub读取', 'user.json');
  try {
    const url = `https://api.github.com/repos/${config.repo}/contents/${config.userDataPath}?ref=${config.branch}`;
    const res = await fetch(url, { headers: { Authorization: `token ${config.token}` } });

    if (!res.ok) {
      console.error('GitHub API错误:', res.status, res.statusText);
      if (res.status === 401) {
        alert('GitHub Token无效或已过期，请检查token权限');
      } else if (res.status === 404) {
        return { players: [] };
      }
      return { players: [] };
    }

    const data = await res.json();

    if (!data.content) {
      console.error('GitHub API没有返回content字段');
      return { players: [] };
    }

    const cleanedContent = data.content.replace(/\s/g, '');
    const bytes = Uint8Array.from(atob(cleanedContent), c => c.charCodeAt(0));
    const jsonStr = new TextDecoder("utf-8").decode(bytes);
    const parsed = JSON.parse(jsonStr);

    const result = {
      players: Array.isArray(parsed.players) ? parsed.players : []
    };
    perf.end(key);
    return result;
  } catch (error) {
    console.error('加载用户数据失败:', error);
    perf.end(key);
    return { players: [] };
  }
}

// 从 GitHub 读取排行榜数据
export async function loadLeaderboardData() {
  const key = perf.start('GitHub读取', 'leaderboard.json');
  try {
    const url = `https://api.github.com/repos/${config.repo}/contents/src/leaderboard.json?ref=${config.branch}`;
    const res = await fetch(url, { headers: { Authorization: `token ${config.token}` } });

    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    const cleanedContent = data.content.replace(/\s/g, '');
    const bytes = Uint8Array.from(atob(cleanedContent), c => c.charCodeAt(0));
    const jsonStr = new TextDecoder("utf-8").decode(bytes);
    const result = JSON.parse(jsonStr);
    perf.end(key);
    return result;
  } catch (error) {
    console.error('加载排行榜数据失败:', error);
    perf.end(key);
    return null;
  }
}

// 加载所有比赛数据
export async function loadAllMatchData() {
  const key = perf.start('GitHub读取', '所有比赛数据');
  try {
    const dirUrl = `https://api.github.com/repos/${config.repo}/contents/src/match?ref=${config.branch}`;
    const response = await fetch(dirUrl, {
      headers: { "Authorization": `token ${config.token}` }
    });

    if (!response.ok) {
      return [];
    }

    const files = await response.json();
    const matchFiles = files.filter(file => file.name.endsWith('.json') && file.name !== 'README.md');


    const matches = [];
    for (const file of matchFiles) {
      try {
        const fileResponse = await fetch(file.download_url);
        if (fileResponse.ok) {
          const matchData = await fileResponse.json();
          matches.push(matchData);
        }
      } catch (error) {
        console.error(`加载比赛文件 ${file.name} 失败:`, error);
      }
    }

    perf.end(key);
    return matches;
  } catch (error) {
    console.error('加载比赛数据失败:', error);
    perf.end(key);
    return [];
  }
}

// 兼容性函数：从 GitHub 读取数据（保持向后兼容）
export async function loadDataWithToken() {
  try {
    // 尝试加载用户数据
    const userData = await loadUserData();

    // 加载排行榜数据
    const leaderboardData = await loadLeaderboardData();

    // 加载所有比赛数据
    const matchData = await loadAllMatchData();

    return {
      players: userData.players,
      matches: matchData,
      leaderboard: leaderboardData
    };
  } catch (error) {
    console.error('加载数据失败:', error);
    return { players: [], matches: [], leaderboard: null };
  }
}

// 上传文件到 GitHub
export async function uploadFileToGithub(token, filePath, file) {
  let sha = undefined;
  const checkRes = await fetch(`https://api.github.com/repos/${config.repo}/contents/${filePath}?ref=${config.branch}`, {
    headers: { Authorization: `token ${config.token}` }
  });
  if (checkRes.ok) {
    const { sha: existingSha } = await checkRes.json();
    sha = existingSha;
  }

  const reader = new FileReader();
  return new Promise((resolve, reject) => {
    reader.onload = async e => {
      const arrayBuffer = e.target.result;
      const bytes = new Uint8Array(arrayBuffer);
      const content = btoa(String.fromCharCode(...bytes));
      const res = await fetch(`https://api.github.com/repos/${config.repo}/contents/${filePath}`, {
        method: "PUT",
        headers: {
          "Authorization": `token ${config.token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: `Upload ${file.name}`,
          content,
          sha,
          branch: config.branch
        })
      });
      if (res.ok) {
        resolve(await res.json());
      } else {
        const error = await res.json();
        console.error("GitHub API错误:", error);
        reject(error);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// 保存数据到 GitHub
export async function saveToGithub(players, matches) {
  const key = perf.start('GitHub保存', 'saveToGithub');
  const blob = new Blob([JSON.stringify({ players, matches }, null, 2)], { type: "application/json" });
  try {
    let sha = undefined;
    const checkRes = await fetch(`https://api.github.com/repos/${config.repo}/contents/${config.path}?ref=${config.branch}`, {
      headers: { Authorization: `token ${config.token}` }
    });
    if (checkRes.ok) {
      const { sha: existingSha } = await checkRes.json();
      sha = existingSha;
    }

    const reader = new FileReader();
    return new Promise((resolve, reject) => {
      reader.onload = async e => {
        const content = btoa(e.target.result);
        const res = await fetch(`https://api.github.com/repos/${config.repo}/contents/${config.path}`, {
          method: "PUT",
          headers: {
            "Authorization": `token ${config.token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            message: "Update game data",
            content,
            sha,
            branch: config.branch
          })
        });
        if (res.ok) {
          perf.end(key);
          resolve();
        } else {
          const error = await res.json();
          console.error("GitHub API错误:", error);
          if (error.message && error.message.includes("must be 100 MB or smaller")) {
            alert("文件太大（超过100MB），无法保存到GitHub。请减少数据量。");
          }
          perf.end(key);
          reject(error);
        }
      };
      reader.readAsBinaryString(blob);
    });
  } catch (error) {
    console.error('保存失败:', error);
    alert('保存失败，请检查网络连接和GitHub Token权限');
    perf.end(key);
    throw error;
  }
}

// 确保 match 目录存在
export async function ensureMatchDirectoryExists() {
  try {
    const dirUrl = `https://api.github.com/repos/${config.repo}/contents/src/match?ref=${config.branch}`;
    const checkRes = await fetch(dirUrl, {
      headers: { "Authorization": `token ${config.token}` }
    });

    if (checkRes.status === 404) {
      const readmePath = "src/match/README.md";
      const content = "# Match Files\n\nThis directory contains individual match JSON files.";
      const encoded = btoa(content);

      const createRes = await fetch(`https://api.github.com/repos/${config.repo}/contents/${readmePath}`, {
        method: "PUT",
        headers: {
          "Authorization": `token ${config.token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: "Create src/match directory with README",
          content: encoded,
          branch: config.branch
        })
      });

      if (createRes.ok) {
        return true;
      } else {
        console.error("创建目录失败:", await createRes.json());
        return false;
      }
    } else if (checkRes.ok) {
      return true;
    } else {
      console.error("检查目录失败:", checkRes.status);
      return false;
    }
  } catch (error) {
    console.error("确保目录存在时出错:", error);
    return false;
  }
}

// 保存用户数据
export async function saveUserData(userJson, sha) {
  const key = perf.start('GitHub保存', 'saveUserData');
  try {
    console.log('📝 正在保存用户数据到GitHub:', {
      repo: config.repo,
      path: config.userDataPath,
      branch: config.branch,
      hasSha: !!sha,
      newestMatchID: userJson.newestMatchID
    });

    const content = JSON.stringify(userJson, null, 4);
    const encodedContent = btoa(unescape(encodeURIComponent(content)));

    const requestBody = {
      message: "Update user data",
      content: encodedContent,
      branch: config.branch
    };

    if (sha) {
      requestBody.sha = sha;
    }

    const url = `https://api.github.com/repos/${config.repo}/contents/${config.userDataPath}`;
    console.log('🔗 GitHub API URL:', url);

    const res = await fetch(url, {
      method: "PUT",
      headers: {
        "Authorization": `token ${config.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    if (!res.ok) {
      const error = await res.json();
      console.error("❌ 保存用户数据失败:", {
        status: res.status,
        error: error,
        url: url
      });
      throw new Error(`Failed to save user data: ${error.message || res.status}`);
    }

    console.log('✅ 用户数据已成功保存到GitHub');
    perf.end(key);
  } catch (error) {
    console.error("❌ 保存用户数据异常:", error);
    perf.end(key);
    throw error;
  }
}

// 保存单个比赛文件
export async function saveMatchFile(matchData, matchPath) {
  const key = perf.start('GitHub保存', `saveMatchFile - ${matchData.metadata?.matchid}`);
  try {
    console.log('📝 正在保存比赛文件到GitHub:', {
      matchId: matchData.metadata?.matchid,
      path: matchPath,
      repo: config.repo
    });

    const matchDataCopy = { ...matchData };
    delete matchDataCopy.rounds;


    const jsonString = JSON.stringify(matchDataCopy, null, 4);
    const encodedContent = btoa(unescape(encodeURIComponent(jsonString)));

    let sha = null;
    try {
      const checkRes = await fetch(`https://api.github.com/repos/${config.repo}/contents/${matchPath}?ref=${config.branch}`, {
        headers: { "Authorization": `token ${config.token}` }
      });
      if (checkRes.ok) {
        const fileData = await checkRes.json();
        sha = fileData.sha;
      }
    } catch (error) {
    }

    const requestBody = {
      message: `Save match ${matchData.metadata?.matchid}`,
      content: encodedContent,
      branch: config.branch
    };

    if (sha) {
      requestBody.sha = sha;
    }

    const res = await fetch(`https://api.github.com/repos/${config.repo}/contents/${matchPath}`, {
      method: "PUT",
      headers: {
        "Authorization": `token ${config.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(`Failed to save match: ${error.message || res.status}`);
    }

    const result = await res.json();
    perf.end(key);
    return result;
  } catch (error) {
    console.error(`保存比赛文件失败 (${matchPath}):`, error);
    perf.end(key);
    throw error;
  }
}

// 保存排行榜数据
export async function saveLeaderboardData(leaderboardData) {
  const key = perf.start('GitHub保存', 'saveLeaderboardData');
  try {
    let sha = null;
    try {
      const response = await fetch(`https://api.github.com/repos/${config.repo}/contents/src/leaderboard.json?ref=${config.branch}`, {
        headers: { "Authorization": `token ${config.token}` }
      });
      if (response.ok) {
        const fileData = await response.json();
        sha = fileData.sha;
      }
    } catch (error) {
    }

    const content = JSON.stringify(leaderboardData, null, 4);
    const encodedContent = btoa(unescape(encodeURIComponent(content)));

    const requestBody = {
      message: "Update leaderboard data",
      content: encodedContent,
      branch: config.branch
    };

    if (sha) {
      requestBody.sha = sha;
    }


    const res = await fetch(`https://api.github.com/repos/${config.repo}/contents/src/leaderboard.json`, {
      method: "PUT",
      headers: {
        "Authorization": `token ${config.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    });

    if (!res.ok) {
      const error = await res.json();
      console.error("保存 leaderboard.json 失败:", error);
      throw new Error(`Failed to save leaderboard data: ${error.message || res.status}`);
    }

    perf.end(key);
  } catch (error) {
    console.error("保存 leaderboard.json 失败:", error);
    perf.end(key);
    throw error;
  }
}

// 批量提交多个文件到GitHub（单次commit）
export async function commitMultipleFiles(files, commitMessage = 'Batch update data files') {
  const key = perf.start('GitHub保存', 'commitMultipleFiles');
  try {
    console.log('🔄 [DEBUG] 开始批量提交:', {
      repo: config.repo,
      branch: config.branch,
      files: files.map(f => f.path),
      message: commitMessage,
      filesContentSizes: files.map(f => ({ path: f.path, size: f.content.length }))
    });

    // 1. 获取当前最新commit的SHA
    console.log('📥 [DEBUG] 获取最新commit SHA...');
    const latestCommitRes = await fetch(`https://api.github.com/repos/${config.repo}/git/refs/heads/${config.branch}`, {
      headers: { "Authorization": `token ${config.token}` }
    });

    if (!latestCommitRes.ok) {
      console.error('❌ [DEBUG] 获取最新commit失败:', latestCommitRes.status, latestCommitRes.statusText);
      throw new Error(`Failed to get latest commit: ${latestCommitRes.status}`);
    }

    const latestRef = await latestCommitRes.json();
    const latestCommitSha = latestRef.object.sha;
    console.log('✅ [DEBUG] 最新commit SHA:', latestCommitSha);

    // 2. 获取当前commit的tree
    console.log('🌳 [DEBUG] 获取commit tree...');
    const commitRes = await fetch(`https://api.github.com/repos/${config.repo}/git/commits/${latestCommitSha}`, {
      headers: { "Authorization": `token ${config.token}` }
    });

    if (!commitRes.ok) {
      console.error('❌ [DEBUG] 获取commit失败:', commitRes.status, commitRes.statusText);
      throw new Error(`Failed to get commit: ${commitRes.status}`);
    }

    const commit = await commitRes.json();
    const baseTreeSha = commit.tree.sha;
    console.log('✅ [DEBUG] 基础tree SHA:', baseTreeSha);

    // 3. 创建新的tree（包含所有要更新的文件）
    const treeItems = files.map(file => ({
      path: file.path,
      mode: '100644',
      type: 'blob',
      content: file.content
    }));

    console.log('🌳 [DEBUG] 创建新tree，包含文件:', treeItems.map(item => item.path));

    const treeRes = await fetch(`https://api.github.com/repos/${config.repo}/git/trees`, {
      method: 'POST',
      headers: {
        "Authorization": `token ${config.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree: treeItems
      })
    });

    if (!treeRes.ok) {
      const error = await treeRes.json();
      console.error('❌ [DEBUG] 创建tree失败:', error);
      throw new Error(`Failed to create tree: ${error.message}`);
    }

    const tree = await treeRes.json();
    console.log('✅ [DEBUG] 新tree创建成功，SHA:', tree.sha);

    // 4. 创建新的commit
    console.log('📝 [DEBUG] 创建新commit...');
    const newCommitRes = await fetch(`https://api.github.com/repos/${config.repo}/git/commits`, {
      method: 'POST',
      headers: {
        "Authorization": `token ${config.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: commitMessage,
        tree: tree.sha,
        parents: [latestCommitSha]
      })
    });

    if (!newCommitRes.ok) {
      const error = await newCommitRes.json();
      console.error('❌ [DEBUG] 创建commit失败:', error);
      throw new Error(`Failed to create commit: ${error.message}`);
    }

    const newCommit = await newCommitRes.json();
    console.log('✅ [DEBUG] 新commit创建成功，SHA:', newCommit.sha);

    // 5. 更新branch引用指向新commit
    console.log('🔄 [DEBUG] 更新分支引用...');
    const updateRefRes = await fetch(`https://api.github.com/repos/${config.repo}/git/refs/heads/${config.branch}`, {
      method: 'PATCH',
      headers: {
        "Authorization": `token ${config.token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sha: newCommit.sha
      })
    });

    if (!updateRefRes.ok) {
      const error = await updateRefRes.json();
      console.error('❌ [DEBUG] 更新分支引用失败:', error);
      throw new Error(`Failed to update ref: ${error.message}`);
    }

    console.log('🎉 [DEBUG] 批量提交完全成功!', {
      commitSha: newCommit.sha,
      filesCount: files.length,
      commitMessage: commitMessage,
      filePaths: files.map(f => f.path)
    });

    perf.end(key);
    return newCommit;

  } catch (error) {
    console.error('❌ 批量提交失败:', error);
    perf.end(key);
    throw error;
  }
}