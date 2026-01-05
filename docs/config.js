// API 配置文件 - 僅使用 Ngrok 模式

const CONFIG = {
  // Ngrok URL（需要手動更新）
  // 每次啟動 ngrok 時，URL 可能會改變，請更新此處
  // 執行: ngrok http 5000
  // 然後複製顯示的 Forwarding URL（https://xxxx.ngrok-free.app）
  API_URL: 'https://karissa-unsiding-graphemically.ngrok-free.dev'
};

// 如果從 HTML 引入，將配置暴露到全局
if (typeof window !== 'undefined') {
  window.API_CONFIG_EXTERNAL = CONFIG;
}
