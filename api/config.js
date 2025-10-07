// Vercel Serverless Function
// 这个文件会被 Vercel 自动识别为 API 端点

export default function handler(_req, res) {
  // 在服务器端可以访问环境变量
  res.status(200).json({
    repo: "LZWuuu/valorant-updater",
    branch: "main",
    path: "data.json",
    token: process.env.Github_TOKEN,
    userDataPath: "src/user.json",
    matchDataPath: "src/match.json",
    henrikapiKey: process.env.Henrik_APIKEY,
    // 添加内部 API 端点
    henrikapiProxy: "/api/henrik"
  });
}