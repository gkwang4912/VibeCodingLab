// ============================================================
// api.js -- 集中管理所有後端 API 呼叫
// ============================================================

const Api = (() => {
    // 取得 API 基礎 URL
    function baseUrl() {
        return (window.APP_CONFIG && window.APP_CONFIG.API_URL) || 'http://localhost:5000';
    }

    // 通用 fetch 包裝，自動加上 ngrok header 與錯誤處理
    async function request(path, options = {}) {
        const url = baseUrl() + path;
        const headers = {
            'Content-Type': 'application/json',
            'ngrok-skip-browser-warning': 'true',
            ...options.headers
        };
        const res = await fetch(url, { ...options, headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    }

    // ---- 健康檢查 / 狀態 ----

    async function healthCheck() {
        return request('/health');
    }

    async function getStatus() {
        return request('/api/status');
    }

    async function restart() {
        return request('/api/restart', { method: 'POST' });
    }

    // ---- 題目 ----

    async function getQuestions() {
        return request('/api/questions');
    }

    async function getQuestionById(id) {
        return request(`/api/questions/${id}`);
    }

    async function refreshQuestions() {
        return request('/api/questions/refresh', { method: 'POST' });
    }

    // ---- 程式執行 ----

    async function executeCode(code, inputs = []) {
        return request('/api/execute', {
            method: 'POST',
            body: JSON.stringify({ code, inputs })
        });
    }

    // ---- 互動式執行 ----

    async function executeInteractive(code) {
        return request('/api/execute/interactive', {
            method: 'POST',
            body: JSON.stringify({ code })
        });
    }

    async function sendInput(sessionId, value) {
        return request(`/api/execute/interactive/${sessionId}/input`, {
            method: 'POST',
            body: JSON.stringify({ value })
        });
    }

    function streamExecution(sessionId, onEvent, onDone, onError) {
        const url = baseUrl() + `/api/execute/interactive/${sessionId}/stream`;
        const controller = new AbortController();

        fetch(url, {
            headers: {
                'ngrok-skip-browser-warning': 'true'
            },
            signal: controller.signal
        })
            .then(async (res) => {
                if (!res.ok) {
                    const text = await res.text().catch(() => '');
                    // 嘗試解析 JSON 錯誤
                    try {
                        const json = JSON.parse(text);
                        throw new Error(json.error || `HTTP ${res.status}`);
                    } catch {
                        throw new Error(`HTTP ${res.status}`);
                    }
                }

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n\n'); // SSE 通常以雙換行分隔
                    buffer = lines.pop(); // 保留未完成的塊

                    for (const chunk of lines) {
                        const linesInChunk = chunk.split('\n');
                        for (const line of linesInChunk) {
                            if (line.startsWith('data: ')) {
                                const dataStr = line.slice(6).trim();
                                try {
                                    const data = JSON.parse(dataStr);
                                    if (data.type === 'done') {
                                        onDone && onDone();
                                        return; // 結束
                                    } else if (data.type === 'error') {
                                        onError && onError(data.data);
                                        return;
                                    } else {
                                        onEvent && onEvent(data);
                                    }
                                } catch (e) {
                                    console.error('Parse error', e);
                                }
                            }
                        }
                    }
                }
            })
            .catch((err) => {
                if (err.name === 'AbortError') return;
                onError && onError(err.message || 'Connection errored');
            });

        return { close: () => controller.abort() };
    }

    async function validateCode(code) {
        return request('/api/validate', {
            method: 'POST',
            body: JSON.stringify({ code })
        });
    }

    // ---- AI 功能 ----

    async function aiAnalyze(payload) {
        // payload: { code, output, expected_output, question }
        return request('/api/ai/analyze', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    }

    async function aiCheck(payload) {
        // payload: { code, output, expected_output }
        return request('/api/ai/check', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    }

    async function aiSuggest(payload) {
        // payload: { code, stats, output, score }
        return request('/api/ai/suggest', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    }

    // AI 對話 -- SSE 流式輸出
    // 回傳 { reader, abort } 供呼叫者逐 chunk 讀取
    function aiChat(payload, onChunk, onDone, onError) {
        const url = baseUrl() + '/api/ai/chat';
        const controller = new AbortController();

        fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'ngrok-skip-browser-warning': 'true'
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        })
            .then(async (res) => {
                if (!res.ok) {
                    const body = await res.json().catch(() => ({}));
                    throw new Error(body.error || `HTTP ${res.status}`);
                }
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop(); // 保留未完成的行

                    for (const line of lines) {
                        if (!line.startsWith('data: ')) continue;
                        const data = line.slice(6).trim();
                        if (data === '[DONE]') {
                            onDone && onDone();
                            return;
                        }
                        try {
                            const parsed = JSON.parse(data);
                            if (parsed.error) {
                                onError && onError(parsed.error);
                                return;
                            }
                            if (parsed.text) {
                                onChunk && onChunk(parsed.text);
                            }
                        } catch { /* 跳過無法解析的行 */ }
                    }
                }
                onDone && onDone();
            })
            .catch((err) => {
                if (err.name === 'AbortError') return;
                onError && onError(err.message);
            });

        return { abort: () => controller.abort() };
    }

    // ---- 成績 ----

    async function submitScore(payload) {
        // payload: { student_name, question_id, score, code, detailed_scores }
        return request('/api/scores/submit', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
    }

    async function getScores(studentName) {
        return request(`/api/scores/${encodeURIComponent(studentName)}`);
    }

    // ---- 公開介面 ----
    return {
        healthCheck, getStatus, restart,
        getQuestions, getQuestionById, refreshQuestions,
        executeCode, validateCode,
        executeInteractive, sendInput, streamExecution,
        aiAnalyze, aiCheck, aiSuggest, aiChat,
        submitScore, getScores
    };
})();
