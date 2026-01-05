// Monaco Editor 變數
let monacoEditor = null;

// 後端API配置 - 僅使用 Ngrok 模式
const API_BASE_URL = window.API_CONFIG_EXTERNAL?.API_URL || 'https://karissa-unsiding-graphemically.ngrok-free.dev';

// 提示詞測試管理
const promptTester = {
  customPrompts: {
    analyze: null,
    check: null,
    suggest: null,
    chat: null
  },
  defaultPrompts: {
    analyze: `你是一位專業的 Python 程式教學專家。請全面分析以下學生的程式碼：

【題目要求】
{question}

【學生程式碼】
\`\`\`python
{code}
\`\`\`

【程式執行結果】
{output}

【預期輸出】
{expected_output}

請提供以下六項評估：

1. **feedback**: 針對程式的整體評語，包括：
   - 程式碼是否正確
   - 輸出是否符合預期
   - 具體的改進建議（3-5點）
   - 語法錯誤或邏輯問題（如果有）

2. **overall_score**: 程式整體評分 (0-100)
   - 綜合考量所有面向的表現

3. **time_complexity_score**: 時間複雜度評分 (0-10)
   - 評估演算法效率
   - 是否有不必要的迴圈或重複計算
   - 是否使用最佳化的資料結構

4. **space_complexity_score**: 空間複雜度評分 (0-10)
   - 評估記憶體使用效率
   - 是否有不必要的變數或資料結構
   - 是否可以更精簡

5. **readability_score**: 程式易讀性評分 (0-10)
   - 變數命名是否清晰
   - 程式碼結構是否清楚
   - 是否有適當的註解
   - 程式碼風格是否一致

6. **stability_score**: 程式穩定性評分 (0-10)
   - 是否有錯誤處理機制
   - 是否考慮邊界條件
   - 是否有潛在的執行時錯誤

**重要**: 
- overall_score 是 0-100 分
- time_complexity_score, space_complexity_score, readability_score, stability_score 都是 0-10 分
- 請確保評分在指定範圍內

請用繁體中文回覆，並確保評分合理反映程式品質。`,
    check: `快速檢查這段 Python 程式：

程式碼：
{code}

實際輸出：
{output}

預期輸出：
{expected_output}

請回答：
1. 輸出是否完全一致？（是/否）
2. 給予分數 (0-100)
3. 如果不一致，指出差異在哪裡

用 JSON 格式回覆：
{
    "match": true/false,
    "score": 85,
    "differences": ["差異1", "差異2"]
}`,
    suggest: `你是一位專業且親切的程式設計老師，使用「引導式學習」教導學生寫程式。

【教學規則】
1. 不直接給完整答案，先用問題與提示一步步引導學生自己思考
2. 每次回覆時，都要先肯定學生的一小部分（例如：哪段想法是對的、哪裡寫得不錯）
3. 根據學生的程式碼，說明目前狀況是否正確，若有錯誤，用簡單的話說明問題點，並給 1～3 個提示讓學生自己修正
4. 在回覆結尾，一定要主動提出 3～5 個相關且能深化理解的「後續問題」，格式為 Q1、Q2、Q3...
5. 回覆語氣友善、清楚，用繁體中文（台灣用語），讓學生感到被支持、陪伴，而不是被糾正

【當前教學情境】
學生得分：{score}

程式碼內容：
\`\`\`python
{code}
\`\`\`

執行結果：
{output}

學習統計：
- 執行次數：{run_count}
- 錯誤次數：{error_count}
- 成功率：{success_rate}%
- 修改次數：{modifications}
在回覆結尾，一定要主動提出 3～5 個相關且能深化理解的「後續問題」，格式為 Q1、Q2、Q3...`,
    chat: `你是一位專業且親切的程式設計老師，使用「引導式學習」教導學生寫程式。

【教學規則】
1. 不直接給完整答案，先用問題與提示一步步引導學生自己思考
2. 每次回覆時，都要先肯定學生的一小部分（例如：哪段想法是對的、哪裡寫得不錯）
3. 根據學生的程式碼，說明目前狀況是否正確，若有錯誤，用簡單的話說明問題點，並給 1～3 個提示讓學生自己修正
4. 在回覆結尾，一定要主動提出 3～5 個相關且能深化理解的「後續問題」，格式為 Q1、Q2、Q3...
5. 回覆語氣友善、清楚，用繁體中文（台灣用語），讓學生感到被支持、陪伴，而不是被糾正
6. 除非學生明確要求「請直接給我完整答案」，否則不要一次貼出完整解答程式碼，只能貼關鍵片段或偽碼做提示

{context}`
  },
  isTestMode: false,
  currentType: 'analyze'
};

// 獲取當前 API URL
function getApiBaseUrl() {
  return API_BASE_URL;
}


// 後端API配置對象（使用 Ngrok URL）
const API_ENDPOINTS = {
  get execute() { return `${getApiBaseUrl()}/api/execute`; },
  get validate() { return `${getApiBaseUrl()}/api/validate`; },
  get status() { return `${getApiBaseUrl()}/api/status`; },
  get restart() { return `${getApiBaseUrl()}/api/restart`; },
  get aiAnalyze() { return `${getApiBaseUrl()}/api/ai/analyze`; },
  get aiCheck() { return `${getApiBaseUrl()}/api/ai/check`; },
  get aiSuggest() { return `${getApiBaseUrl()}/api/ai/suggest`; },
  get aiChat() { return `${getApiBaseUrl()}/api/ai/chat`; }
};

// 狀態資料結構
const stats = {
  // 基本統計
  runCount: 0, aiCheckCount: 0, keyPressCount: 0, mouseClickCount: 0,
  successfulRuns: 0, errorCount: 0,

  // 時間追蹤
  sessionStartTime: Date.now(), lastCodeChangeTime: Date.now(),
  totalCodingTime: 0,

  // 學習行為
  mouseMoveCount: 0, totalClicks: 0, meaningfulMouseMoves: 0,
  lastActivityTime: Date.now(), focusStartTime: Date.now(),
  totalFocusTime: 0, currentFocusStreak: 0, maxFocusStreak: 0,

  // 學習進度
  completedQuestions: 0, totalQuestions: 10, codeModifications: 0,
  totalScores: [], averageScore: 0, lastCodeContent: "",

  // 學生資訊
  studentName: localStorage.getItem('studentName') || '',

  // AI 評分記錄
  lastAiScore: null,
  lastAiScoreCode: '',
  lastAiScoreOutput: ''
};

const weaknessAnalysis = {
  syntaxErrors: 0, codingSpeed: 0, namingIssues: 0,
  analyzeWeaknesses() {
    // 依據統計推估弱點（簡化模型）
    const minutes = Math.max(1, (Date.now() - stats.sessionStartTime) / 60000);
    this.syntaxErrors = Math.min(100, Math.round((stats.errorCount / Math.max(1, stats.runCount)) * 100));
    this.codingSpeed = Math.min(100, Math.round((stats.codeModifications / minutes) * 10)); // 修改密度
    // 命名議題：偵測非慣用命名（簡單啟發式）
    const code = getCode();
    const badNames = (code.match(/\b([A-Z]{2,}|[a-zA-Z]\d{2,})\b/g) || []).length;
    this.namingIssues = Math.min(100, badNames * 10);

    this.updateWeaknessDisplay();
    this.generateSuggestions();
  },
  updateWeaknessDisplay() {
    const wSyntax = document.getElementById('weakSyntax');
    const wSpeed = document.getElementById('weakSpeed');
    const wName = document.getElementById('weakNaming');
    const bSyntax = document.getElementById('weakSyntaxBar');
    const bSpeed = document.getElementById('weakSpeedBar');
    const bName = document.getElementById('weakNamingBar');

    // 檢查元素是否存在
    if (!wSyntax || !wSpeed || !wName || !bSyntax || !bSpeed || !bName) {
      return; // 元素不存在時直接返回，避免錯誤
    }

    const s = isNaN(this.syntaxErrors) ? 0 : this.syntaxErrors;
    const c = isNaN(this.codingSpeed) ? 0 : this.codingSpeed;
    const n = isNaN(this.namingIssues) ? 0 : this.namingIssues;

    wSyntax.textContent = s + "% 頻率";
    wSpeed.textContent = c + "% 頻率";
    wName.textContent = n + "% 頻率";
    bSyntax.style.width = s + "%";
    bSpeed.style.width = c + "%";
    bName.style.width = n + "%";
  },
  generateSuggestions() {
    const list = document.getElementById('aiSuggestionList');
    if (!list) return; // 元素不存在時直接返回

    list.innerHTML = "";
    const suggestions = [];
    if (this.syntaxErrors >= 30) {
      suggestions.push("降低語法錯誤：輸出前先檢查引號是否成對、括號是否完整。");
    }
    if (this.codingSpeed >= 40) {
      suggestions.push("提升效率：先列出步驟，再分段撰寫與測試，避免反覆小修改。");
    }
    if (this.namingIssues >= 30) {
      suggestions.push("命名優化：採用小寫加底線，例如 total_score、run_count。");
    }
    if (suggestions.length === 0) {
      suggestions.push("表現穩定！持續保持良好的輸入與檢查習慣。");
    }
    for (const s of suggestions) {
      const li = document.createElement('li');
      li.textContent = s;
      list.appendChild(li);
    }
  }
};

// DOM 獲取
const editorContainer = document.getElementById('codeEditor');
const outputBox = document.getElementById('outputBox');
const runBtn = document.getElementById('runBtn');
const aiCheckBtn = document.getElementById('aiCheckBtn');
const runStatus = document.getElementById('runStatus');
const aiStatus = document.getElementById('aiStatus');

// 期望輸出
const expectedOutput = [
  "Hello, Python!",
  "我正在學習基礎輸出",
  "這是第 1 題 ✅"
];

// 工具：格式化時間
function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function getCode() {
  return monacoEditor ? monacoEditor.getValue() : "";
}

// 更新顯示：統一入口
function updateStatsDisplay() {
  // 輔助函數：安全設置文本內容
  const safeSetText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  // 輔助函數：安全設置樣式
  const safeSetStyle = (id, property, value) => {
    const el = document.getElementById(id);
    if (el) el.style[property] = value;
  };

  // 🆕 顯示學生姓名
  safeSetText('studentNameText', stats.studentName || '未設定');

  // 頂部進度與統計
  safeSetText('runCount', stats.runCount);
  safeSetText('codeModCount', stats.codeModifications);
  safeSetText('codeModBottom', stats.codeModifications);
  safeSetText('successfulRuns', stats.successfulRuns);
  safeSetText('errorCount', stats.errorCount);

  // 平均分數
  const avg = stats.totalScores.length ? Math.round(stats.totalScores.reduce((a, b) => a + b, 0) / stats.totalScores.length) : 0;
  stats.averageScore = avg;
  safeSetText('avgScore', avg);

  // 學習時間
  const now = Date.now();
  const sessionDuration = now - stats.sessionStartTime;
  safeSetText('sessionDuration', formatTime(sessionDuration));
  safeSetText('totalTimeText', formatTime(stats.totalCodingTime));
  safeSetText('totalTimeTextCard', formatTime(stats.totalCodingTime));

  // 鍵盤 / 滑鼠 / 點擊
  safeSetText('keyPressCount', stats.keyPressCount);
  safeSetText('clickCount', stats.totalClicks);
  safeSetText('mouseMoveCount', stats.mouseMoveCount);

  // 每分鐘
  const mins = Math.max(1, (now - stats.sessionStartTime) / 60000);
  safeSetText('clickPerMin', Math.round(stats.totalClicks / mins));
  safeSetText('keyPerMin', Math.round(stats.keyPressCount / mins));

  // 進度條（行為）
  const clamp = (v) => Math.max(0, Math.min(100, v));
  safeSetStyle('mouseMoveBar', 'width', clamp(stats.mouseMoveCount / 5) + "%");
  safeSetStyle('clickBar', 'width', clamp(stats.totalClicks * 5) + "%");
  safeSetStyle('keyPressBar', 'width', clamp(stats.keyPressCount / 3) + "%");
  safeSetText('mouseMoveActive', clamp(stats.meaningfulMouseMoves) + "%");

  // 專注時間與條
  safeSetText('focusTimeText', formatTime(stats.totalFocusTime));
  safeSetText('focusStreakText', Math.round(stats.currentFocusStreak / 1000) + "s");
  const focusPercent = clamp((stats.currentFocusStreak / 1000) / 60 * 100); // 60s = 100%
  safeSetStyle('focusBar', 'width', focusPercent + "%");

  // 成功率
  const successRate = stats.runCount ? Math.round((stats.successfulRuns / stats.runCount) * 100) : 0;
  safeSetText('successRate', successRate + "%");

  // 平均編程時間（估：總編碼時間 / 修改次數）
  const avgCoding = stats.codeModifications ? stats.totalCodingTime / stats.codeModifications : 0;
  safeSetText('avgCodingTime', formatTime(avgCoding));

  // 累計分數數量
  safeSetText('totalScoreCount', stats.totalScores.length);

  // ⚠️ 注意：不要在這裡更新 AI 評分系統的分數
  // AI 評分系統的分數應該只由 AI 分析結果更新，而不是統計數據
  // 這樣可以避免覆蓋 AI 的詳細評分

  // 如果沒有任何分數記錄，則顯示統計平均分（僅供參考）
  // 但不會覆蓋 AI 分析的詳細評分
}

function updateScoreRing(value) {
  const circle = document.getElementById('scoreRing');
  const radius = 75; // 更新為新的半徑
  const circumference = 2 * Math.PI * radius; // ≈ 471
  const offset = circumference - (value / 100) * circumference;
  circle.style.strokeDasharray = `${circumference}`;
  circle.style.strokeDashoffset = `${offset}`;
  // 顏色根據分數
  if (value >= 85) circle.style.stroke = "#16a34a";
  else if (value >= 70) circle.style.stroke = "#22c55e";
  else if (value >= 50) circle.style.stroke = "#eab308";
  else circle.style.stroke = "#ef4444";
}

function updateLearningProgress() {
  const completed = stats.completedQuestions;
  const total = stats.totalQuestions;
  const percent = Math.round((completed / total) * 100);
  document.getElementById('progressCount').textContent = completed;
  document.getElementById('totalQuestions').textContent = total;
  document.getElementById('progressBar').style.width = percent + "%";
}

function detectCodeModification() {
  const content = getCode();
  if (stats.lastCodeContent !== content) {
    stats.codeModifications++;
    stats.lastCodeContent = content;
    stats.lastCodeChangeTime = Date.now();
    updateStatsDisplay();
  }
}

// 檢查後端狀態
async function checkBackendStatus() {
  try {
    const response = await fetch(API_ENDPOINTS.status, {
      headers: {
        'ngrok-skip-browser-warning': 'true',
        'User-Agent': 'PythonDiagnosticPlatform'
      }
    });

    // 檢查回應是否為 JSON
    const contentType = response.headers.get('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      const text = await response.text();
      console.error('後端回傳非 JSON 內容:', text.substring(0, 200));
      throw new Error('後端回傳了 HTML 而非 JSON，可能是 ngrok 的攔截頁面。請檢查 ngrok 是否正確設定，或嘗試在瀏覽器中直接訪問: ' + API_ENDPOINTS.status);
    }

    const status = await response.json();

    // 更新界面狀態顯示
    const statusElement = document.getElementById('backendStatus');
    if (statusElement) {
      if (status.browser_ready && status.user_tab_ready) {
        statusElement.textContent = '就緒';
        statusElement.className = 'text-xs px-2 py-1 rounded-full bg-green-100 text-green-700 border';
      } else if (status.browser_ready) {
        statusElement.textContent = '初始化中';
        statusElement.className = 'text-xs px-2 py-1 rounded-full bg-yellow-100 text-yellow-700 border';
      } else {
        statusElement.textContent = '離線';
        statusElement.className = 'text-xs px-2 py-1 rounded-full bg-red-100 text-red-700 border';
      }
    }

    return status;
  } catch (err) {
    console.error('後端狀態檢查失敗:', err);
    const statusElement = document.getElementById('backendStatus');
    if (statusElement) {
      statusElement.textContent = 'ngrok 問題';
      statusElement.className = 'text-xs px-2 py-1 rounded-full bg-orange-100 text-orange-700 border';
      statusElement.title = '點擊查看說明';
      statusElement.style.cursor = 'pointer';
      statusElement.onclick = () => showNgrokWarningModal();
    }
    return null;
  }
}

// 初始化後端連接
async function initializeBackend() {
  console.log('🔄 正在初始化 Ngrok 後端連接...');
  console.log('📡 API URL:', getApiBaseUrl());

  // 檢查後端狀態
  await checkBackendStatus();
}

// 顯示 ngrok 攔截警告
function showNgrokWarningModal() {
  const currentUrl = getApiBaseUrl();

  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
  modal.innerHTML = `
    <div class="bg-white rounded-lg p-6 max-w-2xl mx-4 shadow-xl max-h-[90vh] overflow-y-auto">
      <h3 class="text-lg font-bold mb-4 text-gray-800">⚠️ Ngrok 連接問題</h3>
      
      <div class="bg-gray-100 p-3 rounded-lg mb-4 border border-gray-300">
        <p class="text-sm text-gray-600 mb-1"><strong>當前 Ngrok URL：</strong></p>
        <p class="text-sm text-gray-600">
          <code class="bg-white px-2 py-1 rounded text-xs break-all">${currentUrl}</code>
        </p>
      </div>
      
      <div class="space-y-4 text-sm text-gray-600">
        <div class="bg-orange-50 p-3 rounded-lg border border-orange-200">
          <p class="font-semibold text-orange-800 mb-2">🔍 問題診斷</p>
          <p>無法連接到 Ngrok API，可能的原因：</p>
          <ul class="list-disc list-inside space-y-1 text-orange-700 mt-2">
            <li>ngrok 顯示警告頁面（免費版會有「Visit Site」按鈕）</li>
            <li>ngrok URL 已過期或改變</li>
            <li>後端服務（server.py）沒有運行</li>
            <li>防火牆或網路問題阻擋連接</li>
          </ul>
        </div>
        
        <div class="bg-blue-50 p-3 rounded-lg border border-blue-200">
          <p class="font-semibold text-blue-800 mb-2">✅ 解決方案 1：跳過 ngrok 警告頁</p>
          <ol class="list-decimal list-inside space-y-2">
            <li>點擊下方按鈕在新分頁開啟 API：
              <button onclick="window.open('${currentUrl}/api/status', '_blank')" 
                      class="mt-1 bg-blue-500 hover:bg-blue-600 text-white px-3 py-1 rounded text-xs w-full">
                🔗 開啟 ${currentUrl}/api/status
              </button>
            </li>
            <li class="mt-2">如果看到 ngrok 警告頁，點擊「<strong>Visit Site</strong>」按鈕</li>
            <li>確認看到 JSON 回應（例如：{"status": "running", ...}）</li>
            <li>回到此頁面重新整理（<kbd>Ctrl+F5</kbd>）</li>
          </ol>
          <p class="text-xs text-blue-600 mt-2">💡 提示：ngrok 免費版每次啟動 URL 都會改變，需要更新 <code>frontend/config.js</code></p>
        </div>
        
        <div class="bg-green-50 p-3 rounded-lg border border-green-200">
          <p class="font-semibold text-green-800 mb-2">✅ 解決方案 2：確認後端運行</p>
          <p>確認 Python 後端和 ngrok 都已啟動：</p>
          <ol class="list-decimal list-inside space-y-1 mt-2">
            <li>在終端執行：<code class="bg-gray-200 px-2 py-1 rounded text-xs">python server.py</code></li>
            <li>確認看到「伺服器啟動成功」訊息</li>
            <li>在另一個終端執行：<code class="bg-gray-200 px-2 py-1 rounded text-xs">ngrok http 5000</code></li>
            <li>複製 ngrok 的 Forwarding URL 並更新到 <code>frontend/config.js</code></li>
          </ol>
        </div>
        
        <div class="bg-gray-50 p-3 rounded-lg border">
          <p class="font-semibold text-gray-800 mb-2">📚 完整設定指南</p>
          <p>詳細的 ngrok 設定說明請參考：<code class="bg-gray-200 px-2 py-1 rounded text-xs">NGROK_SETUP.md</code></p>
        </div>
      </div>
      
      <div class="flex gap-2 mt-4 flex-wrap">
        <button onclick="this.closest('.fixed').remove()" 
                class="px-4 py-2 bg-gray-500 text-white rounded hover:bg-gray-600 transition-colors">
          關閉
        </button>
        <button onclick="window.location.reload()" 
                class="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 transition-colors">
          🔄 重新整理
        </button>
        <button onclick="window.open('${currentUrl}/api/status', '_blank')" 
                class="px-4 py-2 bg-indigo-500 text-white rounded hover:bg-indigo-600 transition-colors">
          � 測試 API 連接
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

// 保留原本的模擬執行函數作為後備方案
function simulatePythonRun(code) {
  // 簡易偵錯：引號不成對、未關閉括號
  const quoteCount = (code.match(/"/g) || []).length + (code.match(/'/g) || []).length;
  const parenOpen = (code.match(/\(/g) || []).length;
  const parenClose = (code.match(/\)/g) || []).length;
  const hasSyntaxIssue = quoteCount % 2 !== 0 || parenOpen !== parenClose;

  if (hasSyntaxIssue) {
    throw new Error("語法錯誤：請檢查引號或括號是否成對。");
  }

  // 擷取 print("...") 的內容
  const lines = code.split(/\r?\n/);
  const outputs = [];
  for (const line of lines) {
    const m = line.match(/^\s*print\s*\((["'`])(.*)\1\s*\)\s*$/);
    if (m) {
      outputs.push(m[2]);
    }
  }
  if (outputs.length === 0) {
    outputs.push("(沒有檢測到輸出)");
  }
  return outputs.join("\n");
}

// AI 檢查：使用真實的 Gemini API
async function aiCheck() {
  stats.aiCheckCount++;
  aiStatus.textContent = "AI 分析中...";
  aiStatus.className = "text-xs px-2 py-1 rounded-full bg-yellow-100 text-yellow-700 border border-yellow-200";

  try {
    const code = getCode();
    const currentQuestion = window.questionsManager.getCurrentQuestion();

    if (!currentQuestion) {
      throw new Error('找不到當前題目資料');
    }

    let runText = "";

    // 先嘗試執行程式碼獲取輸出
    try {
      const execResponse = await fetch(API_ENDPOINTS.execute, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true',
          'User-Agent': 'PythonDiagnosticPlatform'
        },
        body: JSON.stringify({ code: code })
      });

      const execResult = await execResponse.json();
      if (execResult.success) {
        runText = execResult.output || '';
      } else {
        runText = '執行錯誤: ' + (execResult.error || '未知錯誤');
      }
    } catch (err) {
      console.error('執行失敗，使用模擬輸出:', err);
      runText = simulatePythonRun(code);
    }

    // 構建預期輸出（從測試案例）
    let expectedOutputText = '';
    if (currentQuestion.test_cases && currentQuestion.test_cases.length > 0) {
      expectedOutputText = currentQuestion.test_cases.map(tc =>
        `輸入 ${tc.input} 時，預期輸出: ${tc.output}`
      ).join('\n');
    }

    // 準備請求數據
    const requestData = {
      code: code,
      output: runText,
      expected_output: expectedOutputText,
      question: `${currentQuestion.title}\n${currentQuestion.description}`
    };

    // 🧪 如果提示詞測試模式啟用，添加自訂提示詞
    if (promptTester.isTestMode && promptTester.customPrompts.analyze) {
      requestData.custom_prompt = promptTester.customPrompts.analyze;
      console.log('🧪 使用自訂 analyze 提示詞');
    }

    // 呼叫 AI 分析 API
    const response = await fetch(API_ENDPOINTS.aiAnalyze, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
        'User-Agent': 'PythonDiagnosticPlatform'
      },
      body: JSON.stringify(requestData)
    });

    const result = await response.json();

    if (result.success && result.analysis) {
      const analysis = result.analysis;
      const overallScore = analysis.overall_score || 0;

      // 記錄分數
      stats.totalScores.push(overallScore);

      // 更新完成狀態
      if (overallScore >= 85 && stats.completedQuestions < window.questionsManager.getTotalQuestions()) {
        stats.completedQuestions++;
      }

      // 🆕 提交成績到後端（包含所有評分細項）
      const questionId = currentQuestion.id || currentQuestion.task_number;
      const submitted = await submitScoreToBackend(questionId, overallScore, code, {
        time_complexity: analysis.time_complexity_score,
        space_complexity: analysis.space_complexity_score,
        readability: analysis.readability_score,
        stability: analysis.stability_score
      });

      // 🎯 更新 AI 評分系統的各項分數
      if (analysis.time_complexity_score !== undefined) {
        document.getElementById('subScoreTimeComplexity').textContent = analysis.time_complexity_score;
      }
      if (analysis.space_complexity_score !== undefined) {
        document.getElementById('subScoreSpaceComplexity').textContent = analysis.space_complexity_score;
      }
      if (analysis.readability_score !== undefined) {
        document.getElementById('subScoreReadability').textContent = analysis.readability_score;
      }
      if (analysis.stability_score !== undefined) {
        document.getElementById('subScoreStability').textContent = analysis.stability_score;
      }

      // 更新總分圓環
      updateScoreRing(overallScore);
      document.getElementById('mainScore').textContent = overallScore;

      // 顯示 AI 分析結果
      const list = document.getElementById('aiSuggestionList');
      if (list) list.innerHTML = "";

      // 清空舊評分（現在顯示在 scoreDisplayArea）
      const scoreDisplayArea = document.getElementById('scoreDisplayArea');
      if (scoreDisplayArea) {
        scoreDisplayArea.innerHTML = '';
        // 移除「無評分」提示
        const noScoreYet = document.getElementById('noScoreYet');
        if (noScoreYet) noScoreYet.remove();
      }

      // 記錄評分資料（供對話機器人使用）
      stats.lastAiScore = {
        overall: overallScore,
        time_complexity: analysis.time_complexity_score,
        space_complexity: analysis.space_complexity_score,
        readability: analysis.readability_score,
        stability: analysis.stability_score
      };
      stats.lastAiScoreCode = code;
      stats.lastAiScoreOutput = runText;

      // 添加成績提交狀態提示（只顯示分數，不顯示評語）
      if (submitted) {
        const submittedDiv = document.createElement('div');
        submittedDiv.className = 'bg-green-50 border border-green-200 rounded-lg p-3 shadow-sm';

        // 建立評分詳情文字
        const timeScore = analysis.time_complexity_score !== undefined ? analysis.time_complexity_score : '-';
        const spaceScore = analysis.space_complexity_score !== undefined ? analysis.space_complexity_score : '-';
        const readScore = analysis.readability_score !== undefined ? analysis.readability_score : '-';
        const stabScore = analysis.stability_score !== undefined ? analysis.stability_score : '-';

        submittedDiv.innerHTML = `
          <div class="flex flex-col gap-3">
            <div class="flex items-center gap-2">
              <span class="text-xl">✅</span>
              <span class="font-semibold text-green-800">成績已記錄</span>
            </div>
            
            <!-- 總分大卡片 -->
            <div class="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-3 border border-green-200 text-center">
              <div class="text-xs text-gray-600 mb-1">總分</div>
              <div class="text-3xl font-bold text-green-700">${overallScore}<span class="text-lg text-gray-500">/100</span></div>
            </div>
            
            <!-- 細項分數 - 2x2 網格 -->
            <div class="grid grid-cols-2 gap-2 text-xs">
              <div class="bg-white rounded-lg px-3 py-2 border border-indigo-200">
                <div class="text-gray-500 mb-1">⏱️ 時間</div>
                <div class="text-xl font-bold text-indigo-700">${timeScore}<span class="text-sm text-indigo-400">/10</span></div>
              </div>
              <div class="bg-white rounded-lg px-3 py-2 border border-purple-200">
                <div class="text-gray-500 mb-1">💾 空間</div>
                <div class="text-xl font-bold text-purple-700">${spaceScore}<span class="text-sm text-purple-400">/10</span></div>
              </div>
              <div class="bg-white rounded-lg px-3 py-2 border border-green-200">
                <div class="text-gray-500 mb-1">📖 易讀</div>
                <div class="text-xl font-bold text-green-700">${readScore}<span class="text-sm text-green-400">/10</span></div>
              </div>
              <div class="bg-white rounded-lg px-3 py-2 border border-blue-200">
                <div class="text-gray-500 mb-1">🛡️ 穩定</div>
                <div class="text-xl font-bold text-blue-700">${stabScore}<span class="text-sm text-blue-400">/10</span></div>
              </div>
            </div>
          </div>
        `;
        const scoreDisplayArea = document.getElementById('scoreDisplayArea');
        if (scoreDisplayArea) {
          scoreDisplayArea.appendChild(submittedDiv);
        }
      }

      // 更新狀態
      if (overallScore >= 85) {
        stats.successfulRuns++;
      } else {
        stats.errorCount++;
      }

      // 🆕 自動觸發對話機器人解釋評分結果（立即執行，不延遲）
      autoExplainScore(analysis, overallScore);

    } else {
      throw new Error(result.error || 'AI 分析失敗');
    }

    // 更新顯示
    updateLearningProgress();
    updateStatsDisplay();
    weaknessAnalysis.analyzeWeaknesses();

    aiStatus.textContent = "分析完成 ✓";
    aiStatus.className = "text-xs px-2 py-1 rounded-full bg-green-100 text-green-700 border border-green-200";

  } catch (err) {
    console.error('AI 檢查錯誤:', err);
    stats.errorCount++;

    // 顯示錯誤訊息
    const list = document.getElementById('aiSuggestionList');
    list.innerHTML = "";
    const li = document.createElement('li');
    li.className = 'text-red-600';
    li.textContent = `AI 分析失敗: ${err.message}`;
    list.appendChild(li);

    // 嘗試使用本地模擬分析作為後備
    try {
      const runText = simulatePythonRun(getCode());
      const expected = expectedOutput.join("\n");
      const similarity = compareStrings(expected, runText);
      const score = Math.round(similarity * 100);
      stats.totalScores.push(score);

      const backupLi = document.createElement('li');
      backupLi.textContent = `使用本地分析：相似度 ${score}%`;
      list.appendChild(backupLi);
    } catch (e) {
      console.error('本地分析也失敗:', e);
    }

    updateStatsDisplay();

    aiStatus.textContent = "分析失敗";
    aiStatus.className = "text-xs px-2 py-1 rounded-full bg-red-100 text-red-700 border border-red-200";
  }
}

// 簡易字串相似度（以行為主，逐行比對）
function compareStrings(a, b) {
  const A = a.split("\n");
  const B = b.split("\n");
  const max = Math.max(A.length, B.length);
  if (max === 0) return 1;
  let same = 0;
  for (let i = 0; i < max; i++) if ((A[i] || "") === (B[i] || "")) same++;
  return same / max;
}

// 執行程式 - 呼叫API
async function runProgram() {
  stats.runCount++;
  runStatus.textContent = "執行中...";
  runStatus.className = "text-xs px-2 py-1 rounded-full bg-blue-100 text-blue-700 border";

  // 變更按鈕狀態
  runBtn.disabled = true;
  runBtn.textContent = "執行中...";

  try {
    const code = getCode();
    if (!code.trim()) {
      throw new Error('程式碼不能為空');
    }

    // 檢查程式碼是否使用 input()
    const hasInput = /\binput\s*\(/.test(code);
    let inputs = [];

    if (hasInput) {
      // 顯示輸入對話框
      inputs = await showInputDialog(code);
      if (inputs === null) {
        // 使用者取消
        runBtn.disabled = false;
        runBtn.textContent = "▶️ 執行程式";
        runStatus.textContent = "已取消";
        runStatus.className = "text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-700 border";
        return;
      }
    }

    const response = await fetch(API_ENDPOINTS.execute, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
        'User-Agent': 'PythonDiagnosticPlatform'
      },
      body: JSON.stringify({
        code: code,
        inputs: inputs  // 傳送輸入資料
      })
    });

    const result = await response.json();

    if (result.success) {
      outputBox.textContent = result.output || '執行成功，但沒有輸出';
      outputBox.classList.remove('text-red-300');
      outputBox.classList.add('text-green-200');
      stats.successfulRuns++;
      runStatus.textContent = "完成";
      runStatus.className = "text-xs px-2 py-1 rounded-full bg-green-100 text-green-700 border";
    } else {
      throw new Error(result.error || '執行失敗');
    }

  } catch (err) {
    console.error('執行錯誤:', err);
    outputBox.textContent = `錯誤: ${err.message}`;
    outputBox.classList.remove('text-green-200');
    outputBox.classList.add('text-red-300');
    stats.errorCount++;
    runStatus.textContent = "錯誤";
    runStatus.className = "text-xs px-2 py-1 rounded-full bg-red-100 text-red-700 border";
  } finally {
    // 恢復按鈕狀態
    runBtn.disabled = false;
    runBtn.textContent = "▶️ 執行程式";
    updateStatsDisplay();
  }
}

// 顯示輸入對話框
async function showInputDialog(code) {
  // 計算需要多少個輸入
  const inputMatches = code.match(/\binput\s*\(/g);
  const inputCount = inputMatches ? inputMatches.length : 1;

  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
    modal.innerHTML = `
      <div class="bg-white rounded-lg p-6 max-w-md mx-4 shadow-xl">
        <h3 class="text-lg font-bold mb-4 text-gray-800">🔤 程式需要輸入資料</h3>
        <p class="text-sm text-gray-600 mb-4">偵測到程式使用了 <code class="bg-gray-100 px-2 py-1 rounded">input()</code>，請依序輸入資料：</p>
        
        <div id="inputFields" class="space-y-3 mb-4 max-h-64 overflow-y-auto">
          ${Array.from({ length: inputCount }, (_, i) => `
            <div>
              <label class="block text-sm font-semibold text-gray-700 mb-1">輸入 ${i + 1}:</label>
              <input 
                type="text" 
                id="input_${i}" 
                class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="請輸入值"
              />
            </div>
          `).join('')}
        </div>
        
        <div class="flex gap-2">
          <button 
            id="cancelInputBtn" 
            class="flex-1 bg-gray-500 hover:bg-gray-600 text-white py-2 rounded-lg transition-colors">
            取消
          </button>
          <button 
            id="confirmInputBtn" 
            class="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white py-2 rounded-lg transition-colors">
            確認執行
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // 聚焦第一個輸入框
    setTimeout(() => {
      const firstInput = document.getElementById('input_0');
      if (firstInput) firstInput.focus();
    }, 100);

    // 取消按鈕
    document.getElementById('cancelInputBtn').addEventListener('click', () => {
      modal.remove();
      resolve(null);
    });

    // 確認按鈕
    document.getElementById('confirmInputBtn').addEventListener('click', () => {
      const inputs = [];
      for (let i = 0; i < inputCount; i++) {
        const input = document.getElementById(`input_${i}`);
        inputs.push(input.value);
      }
      modal.remove();
      resolve(inputs);
    });

    // Enter 鍵確認（最後一個輸入框）
    const lastInput = document.getElementById(`input_${inputCount - 1}`);
    if (lastInput) {
      lastInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          document.getElementById('confirmInputBtn').click();
        }
      });
    }
  });
}

// 儲存程式碼（localStorage）


// 事件監聽系統
document.addEventListener('keydown', (e) => {
  stats.keyPressCount++;
  stats.lastActivityTime = Date.now();
  if (e.ctrlKey && e.key === 'Enter') {
    e.preventDefault();
    runProgram();
  }
  updateStatsDisplay();
});

document.addEventListener('mousemove', (e) => {
  stats.mouseMoveCount++;
  // 意義性移動估計
  if (stats.mouseMoveCount % 20 === 0) {
    stats.meaningfulMouseMoves = Math.min(100, stats.meaningfulMouseMoves + 1);
  }
  stats.lastActivityTime = Date.now();
  updateStatsDisplay();
});

document.addEventListener('click', (e) => {
  stats.mouseClickCount++;
  stats.totalClicks++;
  stats.lastActivityTime = Date.now();
  updateStatsDisplay();
});

// Monaco Editor 初始化後會設置事件監聽器

window.addEventListener('focus', () => {
  stats.focusStartTime = Date.now();
});

window.addEventListener('blur', () => {
  const now = Date.now();
  stats.totalFocusTime += now - stats.focusStartTime;
  stats.currentFocusStreak = 0;
  updateStatsDisplay();
});

// 專注 streak 計時（每秒）
setInterval(() => {
  stats.currentFocusStreak += 1000;
  if (stats.currentFocusStreak > stats.maxFocusStreak) stats.maxFocusStreak = stats.currentFocusStreak;
  // 自動累積編碼時間：若最近 5 秒內有活動或焦點在
  if (document.hasFocus() && (Date.now() - stats.lastActivityTime) < 5000) {
    stats.totalCodingTime += 1000;
  }
  updateStatsDisplay();
}, 1000);

// 每分鐘更新下一次評估時間顯示
function updateNextAssessmentText() {
  const now = new Date();
  const next = new Date(now.getTime() + 60 * 1000);
  const hh = String(next.getHours()).padStart(2, '0');
  const mm = String(next.getMinutes()).padStart(2, '0');
  document.getElementById('nextAssessment').textContent = `${hh}:${mm}`;
}
updateNextAssessmentText();
setInterval(updateNextAssessmentText, 60 * 1000);

// 每 5 分鐘自動弱點分析（示範可縮短，但遵照規格使用 5 分鐘）
setInterval(() => {
  weaknessAnalysis.analyzeWeaknesses();
}, 5 * 60 * 1000);

// 按鈕
runBtn.addEventListener('click', (e) => { e.preventDefault(); runProgram(); });
aiCheckBtn.addEventListener('click', (e) => { e.preventDefault(); aiCheck(); });

// 對話機器人功能
let isUserScrolling = false; // 追蹤使用者是否主動上捲

// 監控使用者滾動行為
const chatHistory = document.getElementById('chatHistory');
if (chatHistory) {
  chatHistory.addEventListener('scroll', () => {
    const isAtBottom = chatHistory.scrollHeight - chatHistory.scrollTop <= chatHistory.clientHeight + 50;
    isUserScrolling = !isAtBottom;
  });
}

// 自動滾動到底部
function scrollChatToBottom() {
  if (chatHistory && !isUserScrolling) {
    chatHistory.scrollTop = chatHistory.scrollHeight;
  }
}

// 添加訊息到對話歷史（支援流式輸出）
function addChatMessage(content, isUser = false, messageId = null) {
  const chatHistory = document.getElementById('chatHistory');
  if (!chatHistory) return null;

  // 如果提供了 messageId，更新現有訊息
  if (messageId) {
    const existingMessage = document.getElementById(messageId);
    if (existingMessage) {
      const bubble = existingMessage.querySelector('div[class*="rounded-lg"]');
      if (bubble) {
        const textDiv = bubble.querySelector('div.message-content');
        if (textDiv) {
          if (isUser) {
            // 用戶訊息：純文字
            textDiv.innerHTML = content.replace(/\n/g, '<br>');
          } else {
            // AI 訊息：渲染 Markdown
            textDiv.innerHTML = renderMarkdown(content);
          }
        }
      }
      setTimeout(scrollChatToBottom, 50);
      return messageId;
    }
  }

  // 創建新訊息
  const uniqueId = messageId || `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  const messageDiv = document.createElement('div');
  messageDiv.id = uniqueId;
  messageDiv.className = `flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`;

  const bubble = document.createElement('div');
  bubble.className = `max-w-[80%] rounded-lg px-4 py-2.5 ${isUser
    ? 'bg-indigo-600 text-white'
    : 'bg-gray-100 text-gray-800'
    }`;

  // 根據是否為用戶，使用不同的渲染方式
  let renderedContent;
  if (isUser) {
    // 用戶訊息：純文字，保留換行
    renderedContent = content.replace(/\n/g, '<br>');
  } else {
    // AI 訊息：渲染 Markdown
    renderedContent = renderMarkdown(content);
  }

  bubble.innerHTML = `<div class="text-sm message-content">${renderedContent}</div>`;

  messageDiv.appendChild(bubble);
  chatHistory.appendChild(messageDiv);

  // 自動滾動到底部
  setTimeout(scrollChatToBottom, 100);

  return uniqueId;
}

// 🆕 Markdown 渲染函數（類似 ChatGPT）
function renderMarkdown(content) {
  if (!content) return '';

  // 配置 marked.js
  if (typeof marked !== 'undefined') {
    marked.setOptions({
      breaks: true,  // 支援 GitHub 風格的換行
      gfm: true,     // 支援 GitHub Flavored Markdown
      highlight: function (code, lang) {
        // 使用 highlight.js 進行語法高亮
        if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
          try {
            return hljs.highlight(code, { language: lang }).value;
          } catch (err) {
            console.error('Highlight error:', err);
          }
        }
        return code;
      }
    });

    // 渲染 Markdown
    let html = marked.parse(content);

    // 美化樣式（類似 ChatGPT）
    html = html
      .replace(/<p>/g, '<p class="mb-2 leading-relaxed">')
      .replace(/<ul>/g, '<ul class="list-disc list-inside mb-2 space-y-1">')
      .replace(/<ol>/g, '<ol class="list-decimal list-inside mb-2 space-y-1">')
      .replace(/<li>/g, '<li class="ml-2">')
      .replace(/<h1>/g, '<h1 class="text-xl font-bold mb-2 mt-3">')
      .replace(/<h2>/g, '<h2 class="text-lg font-bold mb-2 mt-2">')
      .replace(/<h3>/g, '<h3 class="text-base font-bold mb-1 mt-2">')
      .replace(/<h4>/g, '<h4 class="text-sm font-bold mb-1 mt-1">')
      .replace(/<code>/g, '<code class="bg-gray-200 px-1.5 py-0.5 rounded text-xs font-mono text-red-600">')
      .replace(/<pre>/g, '<pre class="bg-gray-800 text-gray-100 rounded-lg p-3 my-2 overflow-x-auto">')
      .replace(/<pre class="bg-gray-800 text-gray-100 rounded-lg p-3 my-2 overflow-x-auto"><code class="bg-gray-200 px-1.5 py-0.5 rounded text-xs font-mono text-red-600">/g, '<pre class="bg-gray-800 text-gray-100 rounded-lg p-3 my-2 overflow-x-auto"><code class="!bg-transparent !text-gray-100 !p-0">')
      .replace(/<blockquote>/g, '<blockquote class="border-l-4 border-indigo-500 pl-3 italic text-gray-600 my-2">')
      .replace(/<strong>/g, '<strong class="font-semibold">')
      .replace(/<em>/g, '<em class="italic">');

    return html;
  }

  // 如果 marked.js 未載入，使用簡單的換行處理
  return content.replace(/\n/g, '<br>');
}

// 添加載入動畫訊息
function addLoadingMessage() {
  const chatHistory = document.getElementById('chatHistory');
  if (!chatHistory) return null;

  const uniqueId = `loading-${Date.now()}`;
  const messageDiv = document.createElement('div');
  messageDiv.id = uniqueId;
  messageDiv.className = 'flex justify-start';

  const bubble = document.createElement('div');
  bubble.className = 'max-w-[80%] rounded-lg px-4 py-3 bg-gray-100 text-gray-800';
  bubble.innerHTML = `
    <div class="flex items-center gap-2">
      <div class="flex gap-1">
        <div class="w-2 h-2 bg-indigo-600 rounded-full animate-bounce" style="animation-delay: 0ms"></div>
        <div class="w-2 h-2 bg-indigo-600 rounded-full animate-bounce" style="animation-delay: 150ms"></div>
        <div class="w-2 h-2 bg-indigo-600 rounded-full animate-bounce" style="animation-delay: 300ms"></div>
      </div>
      <span class="text-sm text-gray-600">老師正在思考中...</span>
    </div>
  `;

  messageDiv.appendChild(bubble);
  chatHistory.appendChild(messageDiv);

  // 自動滾動到底部
  setTimeout(scrollChatToBottom, 100);

  return uniqueId;
}

// 移除載入動畫訊息
function removeLoadingMessage(loadingId) {
  if (loadingId) {
    const loadingMessage = document.getElementById(loadingId);
    if (loadingMessage) {
      loadingMessage.remove();
    }
  }
}

// 發送對話訊息（使用流式輸出）
async function sendChatMessage() {
  const chatInput = document.getElementById('chatInput');
  const chatSendBtn = document.getElementById('chatSendBtn');

  if (!chatInput || !chatInput.value.trim()) return;

  const userMessage = chatInput.value.trim();
  chatInput.value = '';

  // 顯示使用者訊息
  addChatMessage(userMessage, true);

  // 顯示載入動畫
  const loadingId = addLoadingMessage();

  // 禁用發送按鈕
  chatSendBtn.disabled = true;
  chatSendBtn.textContent = '思考中...';

  try {
    // 獲取當前程式碼和執行結果
    const code = getCode();
    const output = document.getElementById('outputBox')?.textContent || '';

    // 獲取當前題目資訊
    const currentQuestion = window.questionsManager?.getCurrentQuestion();
    const questionContext = currentQuestion ? {
      title: currentQuestion.title || '',
      description: currentQuestion.description || ''
    } : null;

    // 構建完整的系統提示詞
    const systemContext = {
      message: userMessage,
      question: questionContext,
      current_code: code,
      current_output: output,
      last_score: stats.lastAiScore,
      last_score_code: stats.lastAiScoreCode,
      last_score_output: stats.lastAiScoreOutput,
      stats: {
        run_count: stats.runCount,
        error_count: stats.errorCount,
        success_rate: stats.runCount ? Math.round((stats.successfulRuns / stats.runCount) * 100) : 0,
        modifications: stats.codeModifications
      }
    };

    // 🧪 如果提示詞測試模式啟用，添加自訂提示詞
    if (promptTester.isTestMode && promptTester.customPrompts.chat) {
      systemContext.custom_prompt = promptTester.customPrompts.chat;
      console.log('🧪 使用自訂 chat 提示詞');
    }

    // 呼叫對話 API（流式輸出）
    const response = await fetch(API_ENDPOINTS.aiChat, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
        'User-Agent': 'PythonDiagnosticPlatform'
      },
      body: JSON.stringify(systemContext)
    });

    // 移除載入動畫
    removeLoadingMessage(loadingId);

    // 檢查是否為流式輸出
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('text/event-stream')) {
      // 流式輸出處理
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let aiMessageId = null;
      let accumulatedText = '';

      chatSendBtn.textContent = '接收中...';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') break;

            try {
              const parsed = JSON.parse(data);
              if (parsed.text) {
                accumulatedText += parsed.text;
                // 更新或創建 AI 訊息
                aiMessageId = addChatMessage(accumulatedText, false, aiMessageId);
              }
            } catch (e) {
              console.error('解析流式數據錯誤:', e);
            }
          }
        }
      }
    } else {
      // 非流式輸出（後備方案）
      const result = await response.json();

      if (result.success && result.reply) {
        addChatMessage(result.reply, false);
      } else {
        throw new Error(result.error || '對話失敗');
      }
    }

  } catch (err) {
    console.error('對話錯誤:', err);
    // 移除載入動畫（如果還存在）
    removeLoadingMessage(loadingId);
    addChatMessage('抱歉，我現在無法回答。請稍後再試。', false);
  } finally {
    chatSendBtn.disabled = false;
    chatSendBtn.textContent = '發送';
  }
}

// 自動觸發對話機器人解釋評分結果
async function autoExplainScore(analysis, overallScore) {
  console.log('🤖 自動觸發評分解釋 - 總分:', overallScore, '分析:', analysis);

  const chatMessagesDiv = document.getElementById('chatHistory');
  if (!chatMessagesDiv) {
    console.error('❌ 找不到 chatHistory 元素');
    return;
  }

  // 構建評分摘要文字 - 聚焦在當前程式上
  const timeScore = analysis.time_complexity_score !== undefined ? analysis.time_complexity_score : '-';
  const spaceScore = analysis.space_complexity_score !== undefined ? analysis.space_complexity_score : '-';
  const readScore = analysis.readability_score !== undefined ? analysis.readability_score : '-';
  const stabScore = analysis.stability_score !== undefined ? analysis.stability_score : '-';

  const scoreMessage = `請針對我當前這段程式碼進行解釋：為什麼得到 ${overallScore} 分？（時間複雜度: ${timeScore}/10, 空間複雜度: ${spaceScore}/10, 可讀性: ${readScore}/10, 穩定性: ${stabScore}/10）哪些地方寫得好？哪些地方需要改進？請具體說明這段程式碼的問題。`;

  // 顯示自動觸發的用戶訊息（標記為系統自動）
  const userMsgDiv = document.createElement('div');
  userMsgDiv.className = 'flex justify-end mb-3';
  userMsgDiv.innerHTML = `
    <div class="max-w-[80%]">
      <div class="bg-gradient-to-r from-blue-500 to-indigo-500 text-white rounded-2xl px-4 py-2 shadow-md">
        <div class="flex items-center gap-2 mb-1 opacity-75">
          <span class="text-xs">🤖 系統自動詢問</span>
        </div>
        <div class="text-sm leading-relaxed">${scoreMessage}</div>
      </div>
    </div>
  `;
  chatMessagesDiv.appendChild(userMsgDiv);
  chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;

  // 顯示載入動畫
  const loadingId = addLoadingMessage();

  try {
    // 構建完整上下文（與 sendChatMessage 相同）
    const currentQuestion = window.questionsManager?.getCurrentQuestion();
    const systemContext = {
      question: currentQuestion ? `${currentQuestion.title}\n${currentQuestion.description}` : '無題目資訊',
      student_code: getCode(),
      execution_result: stats.lastAiScoreOutput || '',
      last_ai_score: stats.lastAiScore || null,
      last_score_code: stats.lastAiScoreCode || '',
      last_score_output: stats.lastAiScoreOutput || '',
      student_question: scoreMessage, // 使用評分解釋請求
      stats: {
        run_count: stats.runCount,
        error_count: stats.errorCount,
        success_rate: stats.runCount ? Math.round((stats.successfulRuns / stats.runCount) * 100) : 0,
        modifications: stats.codeModifications
      }
    };

    // 呼叫對話 API（流式輸出）
    const response = await fetch(API_ENDPOINTS.aiChat, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
        'User-Agent': 'PythonDiagnosticPlatform'
      },
      body: JSON.stringify(systemContext)
    });

    // 移除載入動畫
    removeLoadingMessage(loadingId);

    // 檢查是否為流式輸出
    const contentType = response.headers.get('content-type');
    if (contentType && contentType.includes('text/event-stream')) {
      // 流式輸出處理
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let aiMessageId = null;
      let accumulatedText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') break;

            try {
              const parsed = JSON.parse(data);
              if (parsed.text) {
                accumulatedText += parsed.text;
                // 更新或創建 AI 訊息
                aiMessageId = addChatMessage(accumulatedText, false, aiMessageId);
              }
            } catch (e) {
              console.error('解析流式數據錯誤:', e);
            }
          }
        }
      }
    } else {
      // 非流式輸出（後備方案）
      const result = await response.json();

      if (result.success && result.reply) {
        addChatMessage(result.reply, false);
      } else {
        throw new Error(result.error || '對話失敗');
      }
    }

  } catch (err) {
    console.error('自動評分解釋錯誤:', err);
    // 移除載入動畫（如果還存在）
    removeLoadingMessage(loadingId);
    addChatMessage('抱歉，無法自動解釋評分結果。', false);
  }
}

// 綁定發送按鈕
const chatSendBtn = document.getElementById('chatSendBtn');
if (chatSendBtn) {
  chatSendBtn.addEventListener('click', sendChatMessage);
}

// 學習進度初始化
async function initFromStorage() {
  // 檢查是否已輸入學生姓名
  if (!stats.studentName) {
    showStudentNameModal();
    return; // 等待使用者輸入姓名後再繼續
  }

  // 顯示歡迎訊息
  console.log(`👋 歡迎, ${stats.studentName}!`);
  console.log(`🌐 使用 Ngrok 模式: ${getApiBaseUrl()}`);

  // 同步 questions manager 的 API URL
  if (window.questionsManager) {
    window.questionsManager.setApiUrl(getApiBaseUrl());
  }

  // 先載入題目
  const questionsLoaded = await window.questionsManager.loadQuestions();

  if (questionsLoaded) {
    // 渲染第一題
    window.questionsManager.renderQuestion();

    // 更新題目總數
    const totalQuestions = window.questionsManager.getTotalQuestions();
    stats.totalQuestions = totalQuestions;
    document.getElementById('totalQuestions').textContent = totalQuestions;

    // 載入學生的歷史成績
    await loadStudentScores();

    console.log('✅ 題目載入完成');
  } else {
    // 題目載入失敗，顯示錯誤訊息
    const container = document.getElementById('questionContainer');
    if (container) {
      container.innerHTML = `
        <div class="bg-red-50 border border-red-200 rounded-2xl p-6 text-center">
          <div class="text-4xl mb-3">⚠️</div>
          <h3 class="text-lg font-bold text-red-800 mb-2">題目載入失敗</h3>
          <p class="text-red-600 mb-4">無法從 Google Sheets 載入題目資料</p>
          <button onclick="window.questionsManager.refreshQuestions().then(() => location.reload())" 
                  class="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition-colors">
            🔄 重試
          </button>
        </div>
      `;
    }
  }

  // Monaco Editor 已經在初始化時載入了保存的代碼
  await initializeBackend();

  updateLearningProgress();
  updateStatsDisplay();
  weaknessAnalysis.analyzeWeaknesses();
}

// 顯示學生姓名輸入對話框
function showStudentNameModal() {
  const modal = document.createElement('div');
  modal.id = 'studentNameModal';
  modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
  modal.innerHTML = `
    <div class="bg-white rounded-lg p-8 max-w-md mx-4 shadow-xl">
      <h2 class="text-2xl font-bold mb-4 text-gray-800">👋 歡迎使用 Python 學習平台</h2>
      <p class="text-gray-600 mb-6">請輸入您的姓名，系統會記錄您的學習進度和成績</p>
      
      <div class="mb-6">
        <label class="block text-sm font-semibold text-gray-700 mb-2">學生姓名 *</label>
        <input 
          type="text" 
          id="studentNameInput" 
          class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          placeholder="請輸入您的姓名"
          maxlength="20"
        />
        <div id="nameError" class="text-red-600 text-sm mt-1 hidden">請輸入姓名</div>
      </div>
      
      <button 
        onclick="submitStudentName()" 
        class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-lg transition-colors duration-200">
        開始學習
      </button>
      
      <div class="mt-4 text-xs text-gray-500 text-center">
        💡 您的姓名將用於記錄學習進度，請確保輸入正確
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // 聚焦到輸入框
  setTimeout(() => {
    const input = document.getElementById('studentNameInput');
    if (input) {
      input.focus();
      // Enter 鍵提交
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          submitStudentName();
        }
      });
    }
  }, 100);
}

// 提交學生姓名
function submitStudentName() {
  const input = document.getElementById('studentNameInput');
  const nameError = document.getElementById('nameError');
  const name = input.value.trim();

  if (!name) {
    nameError.classList.remove('hidden');
    input.classList.add('border-red-500');
    return;
  }

  // 儲存姓名
  stats.studentName = name;
  localStorage.setItem('studentName', name);

  // 關閉對話框
  const modal = document.getElementById('studentNameModal');
  if (modal) {
    modal.remove();
  }

  // 繼續初始化
  initFromStorage();
}

// 載入學生歷史成績
async function loadStudentScores() {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/scores/${encodeURIComponent(stats.studentName)}`, {
      headers: {
        'ngrok-skip-browser-warning': 'true',
        'User-Agent': 'PythonDiagnosticPlatform'
      }
    });

    const result = await response.json();

    if (result.success && result.scores) {
      console.log(`📊 載入了 ${result.scores.length} 筆歷史成績`);

      // 更新統計
      result.scores.forEach(scoreRecord => {
        stats.totalScores.push(scoreRecord.score);
      });

      updateStatsDisplay();
    }
  } catch (error) {
    console.error('載入歷史成績失敗:', error);
  }
}

// 提交成績到後端
async function submitScoreToBackend(questionId, score, code, detailedScores = {}) {
  try {
    if (!stats.studentName) {
      console.warn('未設定學生姓名，無法提交成績');
      return false;
    }

    const response = await fetch(`${getApiBaseUrl()}/api/scores/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
        'User-Agent': 'PythonDiagnosticPlatform'
      },
      body: JSON.stringify({
        student_name: stats.studentName,
        question_id: questionId,
        score: score,
        code: code,
        detailed_scores: detailedScores
      })
    });

    const result = await response.json();

    if (result.success) {
      console.log(`✅ 成績已記錄: 題目 ${questionId}, 總分 ${score}`);
      if (detailedScores.time_complexity) {
        console.log(`   📊 詳細評分 - 時間: ${detailedScores.time_complexity}, 空間: ${detailedScores.space_complexity}, 易讀: ${detailedScores.readability}, 穩定: ${detailedScores.stability}`);
      }
      return true;
    } else {
      console.error('成績記錄失敗:', result.error);
      return false;
    }
  } catch (error) {
    console.error('提交成績時發生錯誤:', error);
    return false;
  }
}

// 監聽題目切換事件
document.addEventListener('questionChanged', (e) => {
  const { question, index } = e.detail;
  console.log(`已切換到題目 ${index + 1}: ${question.title}`);

  // 可以在這裡更新預期輸出等資訊
  // 例如：expectedOutput = question.expected_output;

  // 清空輸出區域
  if (outputBox) {
    outputBox.textContent = '等待程式執行...';
    outputBox.classList.remove('text-red-300');
    outputBox.classList.add('text-green-200');
  }

  // 清空 AI 分析
  const aiAnalysisBox = document.getElementById('aiAnalysisBox');
  if (aiAnalysisBox) {
    aiAnalysisBox.querySelector('div').textContent = '請先執行或使用 AI 檢查，這裡將顯示分析、錯誤定位與改進建議。';
    const suggestionList = document.getElementById('aiSuggestionList');
    if (suggestionList) suggestionList.innerHTML = '';
  }
});

// 初始化後端連接
async function initializeBackend() {
  console.log('🔄 正在初始化後端連接...');

  // 檢查後端狀態
  await checkBackendStatus();
}

// 不要在這裡直接調用 initFromStorage()，等 Monaco Editor 初始化完成後再調用

// 定期檢查後端狀態
setInterval(checkBackendStatus, 10000); // 每10秒檢查一次

// 在頁面載入時顯示 Ngrok 資訊
console.log('🌐 使用 Ngrok 模式');
console.log('📡 API URL:', getApiBaseUrl());

// 測試工具
window.testLearningProgress = {
  completeQuestion() {
    stats.completedQuestions = Math.min(stats.totalQuestions, stats.completedQuestions + 1);
    updateLearningProgress(); updateStatsDisplay();
  },
  addScore(score) {
    stats.totalScores.push(Math.max(0, Math.min(100, score)));
    updateStatsDisplay();
  },
  simulateProgress() {
    stats.keyPressCount += 50;
    stats.totalClicks += 20;
    stats.mouseMoveCount += 200;
    stats.totalCodingTime += 5 * 60 * 1000;
    stats.codeModifications += 5;
    updateLearningProgress(); updateStatsDisplay();
  },
  resetProgress() {
    Object.assign(stats, {
      runCount: 0, aiCheckCount: 0, keyPressCount: 0, mouseClickCount: 0,
      successfulRuns: 0, errorCount: 0,
      sessionStartTime: Date.now(), lastCodeChangeTime: Date.now(),
      totalCodingTime: 0,
      mouseMoveCount: 0, totalClicks: 0, meaningfulMouseMoves: 0,
      lastActivityTime: Date.now(), focusStartTime: Date.now(),
      totalFocusTime: 0, currentFocusStreak: 0, maxFocusStreak: 0,
      completedQuestions: 0, totalQuestions: 10, codeModifications: 0,
      totalScores: [], averageScore: 0, lastCodeContent: ""
    });
    updateLearningProgress(); updateStatsDisplay(); weaknessAnalysis.analyzeWeaknesses();
  },
  simulateError() {
    stats.errorCount++; updateStatsDisplay(); weaknessAnalysis.analyzeWeaknesses();
  },
  analyzeWeaknesses() {
    weaknessAnalysis.analyzeWeaknesses();
  }
};

// Monaco Editor 初始化
function initializeMonacoEditor() {
  require.config({
    paths: {
      'vs': 'https://unpkg.com/monaco-editor@0.44.0/min/vs'
    }
  });

  require(['vs/editor/editor.main'], function () {
    monacoEditor = monaco.editor.create(editorContainer, {
      value: `# 請完成題目要求，輸出三行指定文字
print("Hello, Python!")
print("我正在學習基礎輸出")
print("這是第 1 題 ✅")`,
      language: 'python',
      theme: 'vs-light',
      fontSize: 14,
      lineNumbers: 'on',
      roundedSelection: false,
      scrollBeyondLastLine: false,
      readOnly: false,
      automaticLayout: true,
      minimap: { enabled: false },
      wordWrap: 'on',
      lineHeight: 20,
      padding: { top: 10, bottom: 10 },
      scrollbar: {
        vertical: 'visible',
        horizontal: 'visible',
        verticalScrollbarSize: 8,
        horizontalScrollbarSize: 8
      }
    });

    // 設置事件監聽器
    monacoEditor.onDidChangeModelContent(() => {
      detectCodeModification();
    });

    // 設置快捷鍵 (Ctrl+Enter 執行)
    monacoEditor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      runProgram();
    });

    // 嘗試載入保存的代碼
    try {
      const saved = localStorage.getItem("python_diagnose_code");
      if (saved) {
        monacoEditor.setValue(saved);
        stats.lastCodeContent = saved;
      }
    } catch (e) { }

    console.log('Monaco Editor 初始化完成');

    // Monaco Editor 初始化完成後，執行其他初始化
    initFromStorage();
  });
}

// ==================== 提示詞編輯器功能 ====================
let currentEditingPromptType = null;

function initPromptEditor() {
  const textarea = document.getElementById('promptTextarea');
  const resetBtn = document.getElementById('resetPromptBtn');
  const copyBtn = document.getElementById('copyPromptBtn');
  const testBtn = document.getElementById('testPromptBtn');
  const charCount = document.getElementById('charCount');

  // 字數統計
  textarea?.addEventListener('input', () => {
    if (charCount) {
      charCount.textContent = textarea.value.length;
    }
  });

  // 重置為預設
  resetBtn?.addEventListener('click', () => {
    if (!currentEditingPromptType) return;
    const type = currentEditingPromptType;
    textarea.value = promptTester.defaultPrompts[type];
    promptTester.customPrompts[type] = null;
    updatePromptStatus(type, false);
    showNotification('已重置為預設提示詞', 'info');
    if (charCount) charCount.textContent = textarea.value.length;
  });

  // 複製提示詞
  copyBtn?.addEventListener('click', () => {
    if (textarea) {
      textarea.select();
      document.execCommand('copy');
      showNotification('提示詞已複製到剪貼簿', 'success');
    }
  });

  // 測試提示詞
  testBtn?.addEventListener('click', () => {
    if (!currentEditingPromptType) return;
    const type = currentEditingPromptType;
    const customPrompt = textarea.value.trim();

    if (!customPrompt) {
      showNotification('提示詞內容不能為空', 'error');
      return;
    }

    promptTester.customPrompts[type] = customPrompt;
    promptTester.isTestMode = true;
    updatePromptStatus(type, true);
    updatePromptPreview(type, customPrompt);
    closePromptEditor();

    showNotification(`已啟用 ${getPromptTypeName(type)} 測試模式`, 'success');
    console.log(`🧪 提示詞測試模式已啟用 (${type}):`, customPrompt.substring(0, 100) + '...');

    // 更新測試模式指示器
    const indicator = document.getElementById('promptTestModeIndicator');
    if (indicator) indicator.classList.remove('hidden');
  });

  // 初始化預覽
  updateAllPreviews();
}

// 編輯提示詞
function editPrompt(type) {
  currentEditingPromptType = type;
  const modal = document.getElementById('promptEditorModal');
  const textarea = document.getElementById('promptTextarea');
  const title = document.getElementById('modalPromptTitle');
  const desc = document.getElementById('modalPromptDesc');
  const charCount = document.getElementById('charCount');

  if (!modal || !textarea) return;

  // 設定標題和描述
  const typeInfo = {
    analyze: { name: 'analyze_prompt', desc: '程式碼全面分析與評分 - 用於 AI 評分功能' },
    check: { name: 'check_prompt', desc: '快速輸出檢查 - 用於快速驗證' },
    suggest: { name: 'suggest_prompt', desc: '引導式學習建議 - 用於學習建議' },
    chat: { name: 'chat_system_prompt', desc: 'AI 對話系統 - 用於聊天機器人' }
  };

  if (title) title.textContent = `編輯 ${typeInfo[type].name}`;
  if (desc) desc.textContent = typeInfo[type].desc;

  // 載入當前提示詞
  const currentPrompt = promptTester.customPrompts[type] || promptTester.defaultPrompts[type];
  textarea.value = currentPrompt;
  if (charCount) charCount.textContent = currentPrompt.length;

  // 顯示模態框
  modal.classList.remove('hidden');
}

// 關閉編輯器
function closePromptEditor() {
  const modal = document.getElementById('promptEditorModal');
  if (modal) modal.classList.add('hidden');
  currentEditingPromptType = null;
}

// 更新提示詞狀態
function updatePromptStatus(type, isCustom) {
  const statusEl = document.getElementById(`${type}-status`);
  if (statusEl) {
    if (isCustom) {
      statusEl.textContent = '🧪 測試模式';
      statusEl.className = 'text-green-600 font-semibold';
    } else {
      statusEl.textContent = '使用預設';
      statusEl.className = 'text-gray-400';
    }
  }
}

// 更新提示詞預覽
function updatePromptPreview(type, content) {
  const previewEl = document.getElementById(`${type}-preview`);
  if (previewEl) {
    const preview = content.substring(0, 150) + (content.length > 150 ? '...' : '');
    previewEl.textContent = preview;
  }
}

// 更新所有預覽
function updateAllPreviews() {
  ['analyze', 'check', 'suggest', 'chat'].forEach(type => {
    const prompt = promptTester.customPrompts[type] || promptTester.defaultPrompts[type];
    updatePromptPreview(type, prompt);
    updatePromptStatus(type, !!promptTester.customPrompts[type]);
  });
}

// 獲取提示詞類型名稱
function getPromptTypeName(type) {
  const names = {
    analyze: 'analyze_prompt',
    check: 'check_prompt',
    suggest: 'suggest_prompt',
    chat: 'chat_system_prompt'
  };
  return names[type] || type;
}

// 重置所有提示詞
function resetAllPrompts() {
  if (!confirm('確定要重置所有提示詞為預設值嗎？')) return;

  ['analyze', 'check', 'suggest', 'chat'].forEach(type => {
    promptTester.customPrompts[type] = null;
    updatePromptStatus(type, false);
    updatePromptPreview(type, promptTester.defaultPrompts[type]);
  });

  promptTester.isTestMode = false;
  const indicator = document.getElementById('promptTestModeIndicator');
  if (indicator) indicator.classList.add('hidden');

  showNotification('已重置所有提示詞為預設值', 'success');
}

// 匯出提示詞設定
function exportPrompts() {
  const settings = {
    analyze: promptTester.customPrompts.analyze || promptTester.defaultPrompts.analyze,
    check: promptTester.customPrompts.check || promptTester.defaultPrompts.check,
    suggest: promptTester.customPrompts.suggest || promptTester.defaultPrompts.suggest,
    chat: promptTester.customPrompts.chat || promptTester.defaultPrompts.chat
  };

  const dataStr = JSON.stringify(settings, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `prompts_export_${new Date().getTime()}.json`;
  link.click();
  URL.revokeObjectURL(url);

  showNotification('提示詞設定已匯出', 'success');
}

// 獲取要使用的提示詞（如果有自訂則使用自訂，否則使用預設）
function getPromptForType(type) {
  return promptTester.customPrompts[type] || promptTester.defaultPrompts[type];
}

// 通知函數
function showNotification(message, type = 'info') {
  const colors = {
    success: 'bg-green-500',
    error: 'bg-red-500',
    info: 'bg-blue-500',
    warning: 'bg-yellow-500'
  };

  const notification = document.createElement('div');
  notification.className = `fixed top-20 right-6 ${colors[type]} text-white px-6 py-3 rounded-lg shadow-lg z-50 transition-all duration-300 transform translate-x-0`;
  notification.textContent = message;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.transform = 'translateX(400px)';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// 當 DOM 載入完成後初始化 Monaco Editor
// 當 DOM 載入完成後初始化 Monaco Editor
document.addEventListener('DOMContentLoaded', () => {
  initializeMonacoEditor();
  initPromptEditor(); // 初始化提示詞編輯器

  // 🎯 初始化 AI 評分系統顯示（清空預設值）
  /* 
     注意：這些元素 ID 必須存在於 HTML 中。因為我們重構了 HTML，
     請確保 'mainScore', 'subScoreTimeComplexity' 等 ID 仍然存在。
     如果它們在新的 HTML 結構中被移除或重命名，這裡會報錯。
     根據最新的 HTML 修改，我們移除了詳細評分卡片，改為簡單的列表或後續添加。
     不過為了兼容性，先保留檢查。
  */
  const safeSetText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  safeSetText('mainScore', '-');
  safeSetText('subScoreTimeComplexity', '-');
  safeSetText('subScoreSpaceComplexity', '-');
  safeSetText('subScoreReadability', '-');
  safeSetText('subScoreStability', '-');

  // 重置圓環進度
  const scoreRing = document.getElementById('scoreRing');
  if (scoreRing) {
    scoreRing.style.strokeDashoffset = '471'; // 完全隱藏
  }

  // 初始化 Split.js (可調整大小區塊)
  if (typeof Split !== 'undefined') {
    // 水平分割 (左側編輯區 vs 右側 AI)
    if (document.getElementById('left-panel') && document.getElementById('right-panel')) {
      Split(['#left-panel', '#right-panel'], {
        sizes: [70, 30],
        minSize: [300, 250],
        gutterSize: 12,  // 加粗拖曳條，更容易點擊
        cursor: 'col-resize',
        elementStyle: (dimension, size, gutterSize) => ({
          'flex-basis': `calc(${size}% - ${gutterSize}px)`,
          'flex-grow': '0',   // 禁止自動伸展
          'flex-shrink': '0'  // 禁止自動收縮
        }),
        gutterStyle: (dimension, gutterSize) => ({
          'flex-basis': `${gutterSize}px`
        }),
        onDrag: function () {
          if (monacoEditor) monacoEditor.layout();
        },
        onDragEnd: function () {
          if (monacoEditor) monacoEditor.layout();
        }
      });
    }

    // 垂直分割 (編輯器 vs 輸出)
    if (document.getElementById('editor-panel') && document.getElementById('output-panel')) {
      Split(['#editor-panel', '#output-panel'], {
        direction: 'vertical',
        sizes: [75, 25],
        minSize: [100, 60],
        gutterSize: 12,  // 加粗拖曳條，更容易點擊
        cursor: 'row-resize',
        elementStyle: (dimension, size, gutterSize) => ({
          'flex-basis': `calc(${size}% - ${gutterSize}px)`,
          'flex-grow': '0',
          'flex-shrink': '0'
        }),
        gutterStyle: (dimension, gutterSize) => ({
          'flex-basis': `${gutterSize}px`
        }),
        onDrag: function () {
          if (monacoEditor) monacoEditor.layout();
        },
        onDragEnd: function () {
          if (monacoEditor) monacoEditor.layout();
        }
      });
    }
  }

  // 監聽視窗縮放，確保編輯器重繪
  window.addEventListener('resize', () => {
    if (monacoEditor) monacoEditor.layout();
  });
});