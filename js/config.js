// 配置管理模块
export let config = {
  repo: "LZWuuu/valorant-updater",
  branch: "main",
  path: "data.json",
  token: "",
  userDataPath: "src/user.json",
  matchDataPath: "src/match.json",
  henrikapiKey: "",
  henrikapiProxy: "/api/henrik"
};

// 从 API 获取配置
export async function loadConfig() {
  try {
    const response = await fetch('/api/config');
    if (response.ok) {
      Object.assign(config, await response.json());
    } else {
    }
  } catch (error) {
    console.error('加载配置失败:', error);
  }
}