// 簡單的語法高亮編輯器 (基於 highlight.js)
// 使用雙層結構：底層為高亮顯示層 (pre code)，上層為透明的輸入層 (textarea)

class SimpleEditor {
    constructor(containerId, initialValue = '') {
        this.container = document.getElementById(containerId);
        if (!this.container) return;

        this.value = initialValue;
        this.onChangeCallback = null;

        this.init();
    }

    init() {
        // 清空容器
        this.container.innerHTML = '';
        this.container.style.position = 'relative';
        this.container.style.width = '100%';
        this.container.style.height = '100%';
        this.container.style.overflow = 'hidden';

        // 建立高亮層
        this.highlightLayer = document.createElement('pre');
        this.highlightLayer.className = 'editor-highlight';
        // Layout styles only - visuals moved to CSS
        this.highlightLayer.style.position = 'absolute'; // Change to absolute to match textarea
        this.highlightLayer.style.top = '0';
        this.highlightLayer.style.left = '0';
        this.highlightLayer.style.width = '100%';
        this.highlightLayer.style.height = '100%';
        this.highlightLayer.style.margin = '0'; // Reset
        this.highlightLayer.style.boxSizing = 'border-box';
        this.highlightLayer.style.overflow = 'hidden'; // Hide scroll, synced via JS
        this.highlightLayer.style.pointerEvents = 'none';

        // 建立代碼元素
        this.codeElement = document.createElement('code');
        this.codeElement.className = 'language-python';
        this.highlightLayer.appendChild(this.codeElement);

        // 建立輸入層
        this.textarea = document.createElement('textarea');
        this.textarea.className = 'editor-input';
        this.textarea.value = this.value;
        this.textarea.spellcheck = false;

        // Layout styles only
        this.textarea.style.position = 'absolute';
        this.textarea.style.top = '0';
        this.textarea.style.left = '0';
        this.textarea.style.width = '100%';
        this.textarea.style.height = '100%';
        this.textarea.style.margin = '0'; // Reset
        this.textarea.style.boxSizing = 'border-box';
        this.textarea.style.border = 'none';
        this.textarea.style.background = 'transparent';
        this.textarea.style.color = 'transparent';
        this.textarea.style.caretColor = 'var(--text-primary)';
        this.textarea.style.resize = 'none';
        this.textarea.style.outline = 'none';
        this.textarea.style.overflow = 'auto'; // Textarea controls scroll

        // 關鍵：將 textarea 的文字顏色設為透明，但背景透明，讓底下的高亮層顯示出來
        // 同時 caretColor 設為可見

        this.container.appendChild(this.highlightLayer);
        this.container.appendChild(this.textarea);

        this.bindEvents();
        this.updateHighlight();
    }

    bindEvents() {
        // 同步捲動
        this.textarea.addEventListener('scroll', () => {
            this.highlightLayer.scrollTop = this.textarea.scrollTop;
            this.highlightLayer.scrollLeft = this.textarea.scrollLeft;
        });

        // 輸入監聽
        this.textarea.addEventListener('input', () => {
            this.value = this.textarea.value;
            this.updateHighlight();
            if (this.onChangeCallback) {
                this.onChangeCallback(this.value);
            }
        });

        // Monitor key presses for Tab and Auto-close
        this.textarea.addEventListener('keydown', (e) => {
            // Tab key handling
            if (e.key === 'Tab') {
                e.preventDefault();
                const start = this.textarea.selectionStart;
                const end = this.textarea.selectionEnd;
                // Insert 4 spaces
                this.value = this.value.substring(0, start) + '    ' + this.value.substring(end);
                this.textarea.value = this.value;
                this.textarea.selectionStart = this.textarea.selectionEnd = start + 4;
                this.updateHighlight();
                if (this.onChangeCallback) {
                    this.onChangeCallback(this.value);
                }
            }

            // Auto-close pairs
            const pairs = {
                '(': ')',
                '[': ']',
                '{': '}',
                "'": "'",
                '"': '"'
            };

            if (pairs[e.key]) {
                e.preventDefault();
                const start = this.textarea.selectionStart;
                const end = this.textarea.selectionEnd;
                const closing = pairs[e.key];

                // Insert opening and closing characters
                this.value = this.value.substring(0, start) + e.key + closing + this.value.substring(end);
                this.textarea.value = this.value;

                // Move cursor to between them
                this.textarea.selectionStart = this.textarea.selectionEnd = start + 1;

                this.updateHighlight();
                if (this.onChangeCallback) {
                    this.onChangeCallback(this.value);
                }
            }
        });
    }

    updateHighlight() {
        // 處理 HTML 跳脫字符
        let code = this.value
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

        // 如果最後是換行，加一個空格讓光標能顯示在下一行
        if (code.endsWith('\n')) {
            code += ' ';
        }

        this.codeElement.innerHTML = code;

        // 呼叫 highlight.js
        if (typeof hljs !== 'undefined') {
            // 修正警告：Element previously highlighted.
            this.codeElement.removeAttribute('data-highlighted');
            hljs.highlightElement(this.codeElement);
        }
    }

    getValue() {
        return this.value;
    }

    setValue(val) {
        this.value = val;
        this.textarea.value = val;
        this.updateHighlight();
    }

    onChange(callback) {
        this.onChangeCallback = callback;
    }
}
