// ============================================================
// app.js -- 主應用邏輯（狀態管理、事件綁定、UI 更新）
// ============================================================

(function () {
    'use strict';

    // ========== 應用狀態 ==========
    const state = {
        // 連線
        connected: false,
        // 題目
        questions: [],
        currentQuestion: null,
        // 編輯器 (SimpleEditor 實例)
        editor: null,
        isDirty: false,
        // 執行
        isRunning: false,
        terminalOutput: '',
        lastRunSuccess: null,
        // AI 評分
        isAnalyzing: false,
        scores: null,      // { overall_score, time_complexity_score, ... }
        feedback: '',
        // AI 對話
        chatMessages: [],   // [{ role:'user'|'ai', text }]
        isStreaming: false,
        chatAbort: null,
        // 進度
        studentName: localStorage.getItem('pydiag_student') || '',
        historicalScores: [],
        // 統計
        runCount: 0,
        errorCount: 0,
        sessionStart: Date.now(),
        // 主題
        theme: localStorage.getItem('pydiag_theme') || 'light',
        // 右側 Tab
        activeTab: 'score'
    };

    // ========== DOM 快取 ==========
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const dom = {
        questionSelect: $('#questionSelect'),
        btnRun: $('#btnRun'),
        btnRunIcon: $('#btnRunIcon'),
        btnScore: $('#btnScore'),
        btnScoreIcon: $('#btnScoreIcon'),
        connDot: $('#connDot'),
        connText: $('#connText'),
        themeLight: $('#themeLight'),
        themeDark: $('#themeDark'),
        // Sidebar 左
        questionPanel: $('#questionPanel'),
        questionEmpty: $('#questionEmpty'),
        questionDetails: $('#questionDetails'),
        questionBadge: $('#questionBadge'),
        questionTitle: $('#questionTitle'),
        questionDesc: $('#questionDesc'),
        testCasesSection: $('#testCasesSection'),
        testCasesList: $('#testCasesList'),
        hintsSection: $('#hintsSection'),
        hintsList: $('#hintsList'),
        goalsSection: $('#goalsSection'),
        goalsList: $('#goalsList'),
        sidebarLeftToggle: $('#sidebarLeftToggle'),
        sidebarLeft: $('#sidebarLeft'),
        // 編輯器
        editorContainer: $('#codeEditorContainer'), // 改為容器
        editorDot: $('#editorDot'),
        // 終端機
        terminalOutput: $('#terminalOutput'),
        terminalStatus: $('#terminalStatus'),
        terminalClear: $('#terminalClear'),
        // AI 評分
        scoreValue: $('#scoreValue'),
        scoreBarFill: $('#scoreBarFill'),
        subTime: $('#subTime'),
        subSpace: $('#subSpace'),
        subRead: $('#subRead'),
        subStab: $('#subStab'),
        feedbackText: $('#feedbackText'),
        // 對話
        chatMessages: $('#chatMessages'),
        chatInput: $('#chatInput'),
        chatSend: $('#chatSend'),
        // 進度
        progressList: $('#progressList'),
        progressBarFill: $('#progressBarFill'),
        progressText: $('#progressText'),
        // 狀態列
        statTime: $('#statTime'),
        statRuns: $('#statRuns'),
        statErrors: $('#statErrors'),
        statFocus: $('#statFocus'),
        statQuestion: $('#statQuestion'),
        statBackend: $('#statBackend'),
        // Toast / Modal
        toastContainer: $('#toastContainer'),
        nameModal: $('#nameModal'),
        nameInput: $('#nameInput'),
        nameSubmit: $('#nameSubmit')
    };

    // ========== 工具函式 ==========

    // Markdown 渲染（使用 marked + highlight.js）
    function renderMd(text) {
        if (text == null) return '';
        const str = String(text);
        if (typeof marked !== 'undefined' && marked.parse) {
            try {
                marked.setOptions({
                    highlight: function (code, lang) {
                        if (typeof hljs !== 'undefined' && lang && hljs.getLanguage(lang)) {
                            return hljs.highlight(code, { language: lang }).value;
                        }
                        return code;
                    },
                    breaks: true
                });
                return marked.parse(str);
            } catch { return escapeHtml(str); }
        }
        return escapeHtml(str);
    }

    function escapeHtml(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // Toast 通知
    function showToast(msg, type = 'info', duration = 3500) {
        const el = document.createElement('div');
        el.className = `toast toast--${type}`;
        el.textContent = msg;
        dom.toastContainer.appendChild(el);
        setTimeout(() => { el.remove(); }, duration);
    }

    // 格式化秒數為 m:ss
    function formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    // 難度對應 badge class
    function difficultyClass(diff) {
        if (!diff) return 'question-badge--basic';
        if (diff.includes('入門')) return 'question-badge--beginner';
        if (diff.includes('初級')) return 'question-badge--basic';
        if (diff.includes('中級')) return 'question-badge--mid';
        if (diff.includes('高') || diff.includes('進階')) return 'question-badge--advanced';
        return 'question-badge--basic';
    }

    // ========== 主題 ==========
    function applyTheme(theme) {
        state.theme = theme;
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('pydiag_theme', theme);
        dom.themeLight.classList.toggle('theme-toggle__btn--active', theme === 'light');
        dom.themeDark.classList.toggle('theme-toggle__btn--active', theme === 'dark');
    }

    // ========== 連線偵測 ==========
    let healthTimer = null;

    async function checkHealth() {
        try {
            await Api.healthCheck();
            state.connected = true;
            dom.connDot.className = 'toolbar__status-dot';
            dom.connText.textContent = '已連線';
            dom.statBackend.textContent = '後端 已連線';
            dom.statBackend.className = 'statusbar__item statusbar__item--success';
        } catch {
            state.connected = false;
            dom.connDot.className = 'toolbar__status-dot toolbar__status-dot--offline';
            dom.connText.textContent = '離線';
            dom.statBackend.textContent = '後端 離線';
            dom.statBackend.className = 'statusbar__item';
        }
    }

    function startHealthPoll() {
        checkHealth();
        const interval = (window.APP_CONFIG && window.APP_CONFIG.HEALTH_POLL_INTERVAL) || 30000;
        healthTimer = setInterval(checkHealth, interval);
    }

    // ========== 題目載入 ==========

    async function loadQuestions() {
        try {
            const res = await Api.getQuestions();
            if (res.success && Array.isArray(res.questions)) {
                state.questions = res.questions;
                renderQuestionSelect();
                if (state.questions.length > 0) {
                    selectQuestion(0);
                } else {
                    showQuestionEmpty();
                }
            } else {
                showToast(res.error || '載入題目失敗', 'error');
                showQuestionEmpty();
            }
        } catch (err) {
            showToast('無法連線後端載入題目', 'error');
            showQuestionEmpty();
        }
    }

    function renderQuestionSelect() {
        dom.questionSelect.innerHTML = state.questions.map((q, i) =>
            `<option value="${i}">Q${q.id} - ${q.title}</option>`
        ).join('');
    }

    function selectQuestion(idx) {
        if (idx < 0 || idx >= state.questions.length) return;
        const q = state.questions[idx];
        state.currentQuestion = q;
        dom.questionSelect.value = idx;
        renderQuestionDetails(q);
        dom.statQuestion.textContent = `Q${q.id}`;

        // 重置編輯器（若未修改則清空，否則確認）
        if (!state.isDirty || confirm('切換題目將清除目前程式碼，確定嗎？')) {
            if (state.editor) {
                state.editor.setValue(''); // 使用 editor setValue
            }
            state.isDirty = false;
            state.scores = null;
            state.feedback = '';
            state.lastRunSuccess = null;
            state.terminalOutput = '';
            resetScoreUI();
            dom.terminalOutput.innerHTML = '<span class="terminal-info">-- 按「執行」開始 --</span>';
            dom.terminalStatus.textContent = '就緒';
            dom.terminalStatus.className = 'terminal-panel__status terminal-panel__status--idle';
            dom.editorDot.style.background = 'var(--success)';
        }
    }

    function showQuestionEmpty() {
        dom.questionEmpty.style.display = '';
        dom.questionDetails.style.display = 'none';
    }

    function renderQuestionDetails(q) {
        dom.questionEmpty.style.display = 'none';
        dom.questionDetails.style.display = '';
        dom.questionBadge.textContent = q.difficulty || '一般';
        dom.questionBadge.className = 'question-badge ' + difficultyClass(q.difficulty);
        dom.questionTitle.textContent = q.title;
        dom.questionDesc.textContent = q.description || '';

        // 測試案例
        if (q.test_cases && q.test_cases.length > 0) {
            dom.testCasesSection.style.display = '';
            dom.testCasesList.innerHTML = q.test_cases.map(tc =>
                `<div class="test-case"><span class="test-case__label">輸入：</span><span class="test-case__value">${escapeHtml(tc.input || '')}</span> <span class="test-case__label">期望：</span><span class="test-case__value">${escapeHtml(tc.expected || '')}</span></div>`
            ).join('');
        } else {
            dom.testCasesSection.style.display = 'none';
        }

        // 提示
        if (q.hints && q.hints.length > 0) {
            dom.hintsSection.style.display = '';
            dom.hintsList.textContent = q.hints.join('\n');
        } else {
            dom.hintsSection.style.display = 'none';
        }

        // 學習目標
        if (q.learning_goals && q.learning_goals.length > 0) {
            dom.goalsSection.style.display = '';
            dom.goalsList.innerHTML = q.learning_goals.map(g =>
                `<div class="goal-item">${escapeHtml(g)}</div>`
            ).join('');
        } else {
            dom.goalsSection.style.display = 'none';
        }
    }

    // ========== 程式執行 ==========

    async function runCode() {
        // 從 editor 獲取程式碼
        const code = state.editor ? state.editor.getValue().trim() : '';
        if (!code) {
            showToast('請先輸入程式碼', 'warning');
            return;
        }

        if (!state.connected) {
            showToast('後端離線，無法執行', 'error');
            return;
        }

        state.isRunning = true;
        setBtnLoading(dom.btnRun, dom.btnRunIcon, true);
        dom.terminalStatus.textContent = '執行中...';
        dom.terminalStatus.className = 'terminal-panel__status';
        dom.terminalOutput.innerHTML = ''; // 清空輸出
        state.terminalOutput = '';

        try {
            // 1. 啟動互動式執行 Session
            const res = await Api.executeInteractive(code);
            if (!res.success) {
                throw new Error(res.error || '啟動失敗');
            }

            const sessionId = res.session_id;

            // 2. 開始串流監聽
            const stream = Api.streamExecution(
                sessionId,
                (event) => {
                    // 處理事件
                    if (event.type === 'stdout') {
                        state.terminalOutput += event.data;
                        dom.terminalOutput.innerText = state.terminalOutput; // 即時更新 (innerText 自動處理換行)
                        // 捲動到底部
                        const outputArea = document.getElementById('termContentOutput');
                        if (outputArea) outputArea.scrollTop = outputArea.scrollHeight;
                    } else if (event.type === 'input_request') {
                        // 顯示輸入框 Modal
                        showInputModal(sessionId, event.prompt);
                    }
                },
                () => {
                    // Done
                    state.isRunning = false;
                    state.lastRunSuccess = true;
                    setBtnLoading(dom.btnRun, dom.btnRunIcon, false);
                    dom.terminalStatus.textContent = '完成';
                    dom.terminalStatus.className = 'terminal-panel__status terminal-panel__status--success';
                    updateStats();
                },
                (error) => {
                    // Error
                    state.isRunning = false;
                    state.lastRunSuccess = false;
                    state.errorCount++;
                    const errMsg = `\n[錯誤] ${error}`;
                    state.terminalOutput += errMsg;
                    dom.terminalOutput.innerText = state.terminalOutput;
                    dom.terminalStatus.textContent = '錯誤';
                    dom.terminalStatus.className = 'terminal-panel__status terminal-panel__status--error';
                    setBtnLoading(dom.btnRun, dom.btnRunIcon, false);
                    updateStats();
                }
            );

        } catch (err) {
            state.errorCount++;
            state.lastRunSuccess = false;
            dom.terminalOutput.innerHTML = `<span class="terminal-err">啟動錯誤：${escapeHtml(err.message)}</span>`;
            dom.terminalStatus.textContent = '錯誤';
            dom.terminalStatus.className = 'terminal-panel__status terminal-panel__status--error';
            state.isRunning = false;
            setBtnLoading(dom.btnRun, dom.btnRunIcon, false);
            updateStats();
        }
    }

    // ========== 輸入框 Modal 處理 ==========
    const domInput = {
        modal: $('#inputModal'),
        prompt: $('#inputPrompt'),
        input: $('#inputRequestVal'),
        submit: $('#inputSubmit')
    };

    let currentInputSessionId = null;

    function showInputModal(sessionId, prompt) {
        currentInputSessionId = sessionId;
        domInput.prompt.textContent = prompt || '請輸入資料...';
        domInput.input.value = '';
        domInput.modal.style.display = 'flex';
        domInput.input.focus();
    }

    async function submitInput() {
        if (!currentInputSessionId) return;
        const value = domInput.input.value; // 允許空字串

        try {
            await Api.sendInput(currentInputSessionId, value);
            domInput.modal.style.display = 'none';
            currentInputSessionId = null;
        } catch (err) {
            showToast('傳送輸入失敗: ' + err.message, 'error');
        }
    }

    // 綁定輸入 Modal 事件
    domInput.submit.addEventListener('click', submitInput);
    domInput.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitInput();
    });

    // ========== AI 評分 ==========

    async function analyzeCode() {
        // 從 editor 獲取程式碼
        const code = state.editor ? state.editor.getValue().trim() : '';
        if (!code) {
            showToast('請先輸入程式碼', 'warning');
            return;
        }
        if (!state.connected) {
            showToast('後端離線，無法評分', 'error');
            return;
        }
        // 若尚未執行，先自動執行
        if (state.lastRunSuccess === null) {
            await runCode();
        }
        state.isAnalyzing = true;
        setBtnLoading(dom.btnScore, dom.btnScoreIcon, true);
        dom.feedbackText.innerHTML = '<div class="skeleton" style="height:12px;width:70%;margin-bottom:6px"></div><div class="skeleton" style="height:12px;width:50%"></div>';

        try {
            const payload = {
                code: code,
                output: state.terminalOutput,
                expected_output: '',
                question: state.currentQuestion ? {
                    title: state.currentQuestion.title,
                    description: state.currentQuestion.description
                } : ''
            };
            const res = await Api.aiAnalyze(payload);
            if (res.success && res.analysis) {
                const a = res.analysis;
                state.scores = {
                    overall: a.overall_score,
                    time_complexity: a.time_complexity_score,
                    space_complexity: a.space_complexity_score,
                    readability: a.readability_score,
                    stability: a.stability_score
                };
                state.feedback = a.feedback || '';
                renderScores();

                // 背景提交成績，並重新載入進度
                await submitScoreInBackground();
                loadProgress();
            } else {
                showToast(res.error || 'AI 評分失敗', 'error');
                dom.feedbackText.textContent = res.error || 'AI 評分失敗';
            }
        } catch (err) {
            showToast('AI 評分失敗：' + err.message, 'error');
            dom.feedbackText.textContent = '評分失敗：' + err.message;
        } finally {
            state.isAnalyzing = false;
            setBtnLoading(dom.btnScore, dom.btnScoreIcon, false);
        }
    }

    function renderScores() {
        if (!state.scores) return;
        const s = state.scores;
        dom.scoreValue.textContent = s.overall != null ? s.overall : '--';
        dom.scoreBarFill.style.width = (s.overall || 0) + '%';
        dom.subTime.textContent = s.time_complexity != null ? s.time_complexity : '--';
        dom.subSpace.textContent = s.space_complexity != null ? s.space_complexity : '--';
        dom.subRead.textContent = s.readability != null ? s.readability : '--';
        dom.subStab.textContent = s.stability != null ? s.stability : '--';

        // 處理 feedback 可能是物件的情況
        let feedbackContent = state.feedback;
        if (typeof feedbackContent === 'object' && feedbackContent !== null) {
            // 嘗試提取文字欄位
            if (typeof feedbackContent.text === 'string') feedbackContent = feedbackContent.text;
            else if (typeof feedbackContent.message === 'string') feedbackContent = feedbackContent.message;
            else if (typeof feedbackContent.content === 'string') feedbackContent = feedbackContent.content;
            else if (Array.isArray(feedbackContent)) feedbackContent = feedbackContent.join('\n');
            else feedbackContent = JSON.stringify(feedbackContent, null, 2);
        }

        dom.feedbackText.innerHTML = renderMd(feedbackContent);
    }

    function resetScoreUI() {
        dom.scoreValue.textContent = '--';
        dom.scoreBarFill.style.width = '0%';
        dom.subTime.textContent = '--';
        dom.subSpace.textContent = '--';
        dom.subRead.textContent = '--';
        dom.subStab.textContent = '--';
        dom.feedbackText.textContent = '按「AI 評分」取得回饋';
    }

    async function submitScoreInBackground() {
        if (!state.studentName || !state.currentQuestion || !state.scores) return;
        try {
            await Api.submitScore({
                student_name: state.studentName,
                question_id: state.currentQuestion.id,
                score: state.scores.overall || 0,
                code: state.editor ? state.editor.getValue().slice(0, 100) : '',
                detailed_scores: {
                    time_complexity: state.scores.time_complexity || 0,
                    space_complexity: state.scores.space_complexity || 0,
                    readability: state.scores.readability || 0,
                    stability: state.scores.stability || 0
                }
            });
        } catch { /* 靜默失敗 */ }
    }

    // ========== AI 對話 ==========

    function sendChat() {
        const text = dom.chatInput.value.trim();
        if (!text || state.isStreaming) return;
        if (!state.connected) {
            showToast('後端離線，無法對話', 'error');
            return;
        }
        // 使用者訊息
        state.chatMessages.push({ role: 'user', text });
        appendChatBubble('user', text);
        dom.chatInput.value = '';

        // AI 回覆（SSE）
        state.isStreaming = true;
        dom.chatSend.disabled = true;
        const aiBubble = appendChatBubble('ai', '', true);

        const payload = {
            student_question: text,
            question: state.currentQuestion ? {
                title: state.currentQuestion.title,
                description: state.currentQuestion.description
            } : '',
            student_code: state.editor ? state.editor.getValue() : '',
            execution_result: state.terminalOutput,
            last_ai_score: state.scores,
            stats: {
                run_count: state.runCount,
                error_count: state.errorCount,
                success_rate: state.runCount > 0 ? Math.round(((state.runCount - state.errorCount) / state.runCount) * 100) : 0,
                modifications: 0
            }
        };

        let fullText = '';
        const handle = Api.aiChat(
            payload,
            (chunk) => {
                fullText += chunk;
                aiBubble.innerHTML = renderMd(fullText);
                aiBubble.classList.add('chat-bubble--streaming');
                dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
            },
            () => {
                aiBubble.classList.remove('chat-bubble--streaming');
                state.chatMessages.push({ role: 'ai', text: fullText });
                state.isStreaming = false;
                dom.chatSend.disabled = false;
                state.chatAbort = null;
            },
            (err) => {
                aiBubble.classList.remove('chat-bubble--streaming');
                aiBubble.innerHTML = `<span style="color:var(--error)">錯誤：${escapeHtml(err)}</span>`;
                state.isStreaming = false;
                dom.chatSend.disabled = false;
                state.chatAbort = null;
            }
        );
        state.chatAbort = handle;
    }

    function appendChatBubble(role, text, streaming = false) {
        const el = document.createElement('div');
        el.className = `chat-bubble chat-bubble--${role}`;
        if (streaming) el.classList.add('chat-bubble--streaming');
        el.innerHTML = role === 'ai' ? renderMd(text) : escapeHtml(text);
        dom.chatMessages.appendChild(el);
        dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
        return el;
    }

    // ========== 進度 (真實數據) ==========

    async function loadProgress() {
        if (!state.studentName) return;
        try {
            const res = await Api.getScores(state.studentName);
            if (res.success) {
                // 使用 Map 來去重，只保留每題最高分（或最新）
                // 假設後端返回的是所有紀錄，我們這裡只取唯一題目
                const uniqueScores = {};
                res.scores.forEach(s => {
                    const qid = s.question_id;
                    const val = Number(s.score) || 0;

                    if (!uniqueScores[qid]) {
                        uniqueScores[qid] = s;
                    } else {
                        const existingVal = Number(uniqueScores[qid].score) || 0;
                        if (val > existingVal) {
                            uniqueScores[qid] = s;
                        }
                    }
                });

                state.historicalScores = Object.values(uniqueScores);
                renderProgress();
            }
        } catch { /* 靜默 */ }
    }

    function renderProgress() {
        const total = state.questions.length;
        // 計算唯一完成的題目數量
        // 比對 historicalScores 中的 question_id 是否在 state.questions 中
        const completedIds = new Set(state.historicalScores.map(s => String(s.question_id)));
        let completedCount = 0;

        // 確保只計算目前題目列表中的題目
        state.questions.forEach(q => {
            if (completedIds.has(String(q.id))) {
                completedCount++;
            }
        });

        dom.progressText.textContent = `${completedCount} / ${total} 題完成`;
        dom.progressBarFill.style.width = total > 0 ? Math.round((completedCount / total) * 100) + '%' : '0%';

        if (state.historicalScores.length === 0) {
            dom.progressList.innerHTML = '<div class="empty-state"><div class="empty-state__icon">&#128202;</div><div>尚無紀錄</div></div>';
            return;
        }

        dom.progressList.innerHTML = state.historicalScores.map(s => {
            // 嘗試從 questions 列表中找到標題，如果找不到則用備用文字
            const q = state.questions.find(q => String(q.id) === String(s.question_id));
            const title = q ? q.title : `題目 ${s.question_id}`;
            const scoreClass = s.score >= 80 ? 'text-success' : (s.score >= 60 ? 'text-warning' : 'text-error');

            return `<div class="progress-item" onclick="app.selectQuestionById('${s.question_id}')" style="cursor:pointer">
        <span class="progress-item__id">Q${s.question_id}</span>
        <span class="progress-item__title">${escapeHtml(title)}</span>
        <span class="progress-item__score ${scoreClass}">${s.score}分</span>
      </div>`;
        }).join('');
    }

    // 讓外部可以調用
    window.app = window.app || {};
    window.app.selectQuestionById = (qid) => {
        const idx = state.questions.findIndex(q => String(q.id) === String(qid));
        if (idx !== -1) {
            selectQuestion(idx);
            // 切回編輯器視角 (可選)
            if (window.innerWidth <= 1024) {
                // 手機版可能需要關閉右側
            }
        }
    };

    // ========== Tab 切換 ==========

    function switchTab(tabName) {
        state.activeTab = tabName;
        $$('.ai-tabs__tab').forEach(btn => {
            btn.classList.toggle('ai-tabs__tab--active', btn.dataset.tab === tabName);
        });
        $$('.ai-tab-content').forEach(el => el.classList.remove('ai-tab-content--active'));
        const target = $(`#tab${capitalize(tabName)}`);
        if (target) target.classList.add('ai-tab-content--active');
        // 切換到進度時載入
        if (tabName === 'progress') loadProgress();
    }

    function capitalize(s) {
        return s.charAt(0).toUpperCase() + s.slice(1);
    }

    // ========== 工具列 / 按鈕 ==========

    function setBtnLoading(btn, iconEl, loading) {
        if (loading) {
            iconEl.innerHTML = '<span class="spinner"></span>';
            btn.disabled = true;
        } else {
            // 還原圖示
            if (btn === dom.btnRun) iconEl.innerHTML = '&#9654;';
            if (btn === dom.btnScore) iconEl.innerHTML = '&#9733;';
            btn.disabled = false;
        }
    }

    // ========== 狀態列 ==========

    let statsTimer = null;

    function updateStats() {
        dom.statRuns.textContent = `執行 ${state.runCount} 次`;
        dom.statErrors.textContent = `錯誤 ${state.errorCount}`;
    }

    function startStatsTimer() {
        statsTimer = setInterval(() => {
            const elapsed = Math.floor((Date.now() - state.sessionStart) / 1000);
            dom.statTime.textContent = `學習時間 ${formatTime(elapsed)}`;
        }, 1000);
    }

    // ========== 學生姓名 Modal ==========

    function checkStudentName() {
        if (!state.studentName) {
            dom.nameModal.style.display = '';
        }
        // 初始載入進度
        loadProgress();
    }

    function submitStudentName() {
        const name = dom.nameInput.value.trim();
        if (!name) {
            dom.nameInput.style.borderColor = 'var(--error)';
            return;
        }
        state.studentName = name;
        localStorage.setItem('pydiag_student', name);
        dom.nameModal.style.display = 'none';
        loadProgress();
    }

    // ========== Sidebar 收合 ==========

    let sidebarLeftHidden = false;
    function toggleSidebarLeft() {
        sidebarLeftHidden = !sidebarLeftHidden;
        dom.sidebarLeft.style.display = sidebarLeftHidden ? 'none' : '';
        dom.sidebarLeftToggle.textContent = sidebarLeftHidden ? '\u00BB' : '\u00AB';
    }

    // ========== 快捷鍵 ==========

    function handleKeyboard(e) {
        // Ctrl+Enter = 執行
        if (e.ctrlKey && e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!state.isRunning) runCode();
        }
        // Ctrl+Shift+Enter = AI 評分
        if (e.ctrlKey && e.shiftKey && e.key === 'Enter') {
            e.preventDefault();
            if (!state.isAnalyzing) analyzeCode();
        }
    }

    // ========== 事件綁定 ==========

    function bindEvents() {
        // SimpleEditor 初始化
        if (typeof SimpleEditor !== 'undefined' && dom.editorContainer) {
            state.editor = new SimpleEditor('codeEditorContainer', '');
            state.editor.onChange((val) => {
                state.isDirty = true;
                dom.editorDot.style.background = 'var(--warning)';
            });
        }

        // 題目選擇
        dom.questionSelect.addEventListener('change', () => {
            selectQuestion(parseInt(dom.questionSelect.value, 10));
        });

        // 執行 / AI 評分
        dom.btnRun.addEventListener('click', runCode);
        dom.btnScore.addEventListener('click', analyzeCode);

        // Tab 切換
        $$('.ai-tabs__tab').forEach(btn => {
            btn.addEventListener('click', () => switchTab(btn.dataset.tab));
        });

        // 對話
        dom.chatSend.addEventListener('click', sendChat);
        dom.chatInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendChat();
            }
        });

        // 終端機清除
        dom.terminalClear.addEventListener('click', () => {
            dom.terminalOutput.innerHTML = '<span class="terminal-info">-- 已清除 --</span>';
            dom.terminalStatus.textContent = '就緒';
            dom.terminalStatus.className = 'terminal-panel__status terminal-panel__status--idle';
        });



        // 主題
        dom.themeLight.addEventListener('click', () => applyTheme('light'));
        dom.themeDark.addEventListener('click', () => applyTheme('dark'));

        // Sidebar 收合
        dom.sidebarLeftToggle.addEventListener('click', toggleSidebarLeft);

        // 姓名 Modal
        dom.nameSubmit.addEventListener('click', submitStudentName);
        dom.nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submitStudentName();
        });

        // 快捷鍵
        document.addEventListener('keydown', handleKeyboard);
    }

    // ========== 初始化 ==========

    function init() {
        applyTheme(state.theme);
        bindEvents();
        startHealthPoll();
        startStatsTimer();
        loadQuestions();
        checkStudentName();

        // 縮放時的 DOM class 調整 (輔助)
        const updateLayoutClass = () => {
            if (window.devicePixelRatio > 1.5) {
                document.body.classList.add('high-dpi');
            } else {
                document.body.classList.remove('high-dpi');
            }
        };
        window.addEventListener('resize', updateLayoutClass);
        updateLayoutClass();
    }

    // DOM 載入後啟動
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
