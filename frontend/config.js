// ============================================================
// API 配置 -- 修改此處的 API_URL 即可切換後端位址
// ============================================================

const CONFIG = {
  // 後端 API URL（ngrok 或 localhost）
  // 使用 ngrok 時請更新為最新的 Forwarding URL
  API_URL: 'https://karissa-unsiding-graphemically.ngrok-free.dev',

  // 健康檢查輪詢間隔（毫秒）
  HEALTH_POLL_INTERVAL: 30000,

  // 執行超時秒數（僅前端提示用，實際由後端控制）
  EXECUTION_TIMEOUT_HINT: 5
};

if (typeof window !== 'undefined') {
  window.APP_CONFIG = CONFIG;
}
