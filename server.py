from flask import Flask, request, jsonify, session, Response
from flask_cors import CORS
import sys
import io
import contextlib
import secrets
from datetime import datetime
import ast
import signal
import threading
import time
import re
import json
import google.generativeai as genai
import os
import gspread
from google.oauth2.service_account import Credentials

app = Flask(__name__)
app.secret_key = secrets.token_hex(16)  # 生成隨機密鑰
CORS(app, supports_credentials=True)  # 允許跨域請求並支援 cookie

# 導入題目讀取器
from fetch_questions import fetch_questions_from_sheet

# 載入提示詞配置
prompts_config = {}
try:
    if os.path.exists('prompts.json'):
        with open('prompts.json', 'r', encoding='utf-8') as f:
            prompts_config = json.load(f)
            print('✅ 提示詞配置載入成功')
    else:
        print('⚠️  警告：prompts.json 不存在，將使用預設提示詞')
except Exception as e:
    print(f'⚠️  警告：無法載入提示詞配置: {str(e)}')

# 題目快取
questions_cache = None
questions_last_fetch = None
CACHE_EXPIRE_MINUTES = 30  # 快取 30 分鐘

# Google Sheets 成績記錄配置
SCORES_SPREADSHEET_ID = '1LyKMeDqbsVzEdx7q2ArTngCM5s02gtp27cv_v1wEOVI'
SCORES_SHEET_URL = f'https://docs.google.com/spreadsheets/d/{SCORES_SPREADSHEET_ID}/export?format=csv&gid=0'

# Google Apps Script Web App URL (用於寫入成績)
WEBAPP_URL = 'https://script.google.com/macros/s/AKfycbzLPGUzL1HnRkSgEua3TZO4zildeJ2cQGuihgY4HXYPSYxD4-b7kf1maMNBimDdjoMEdQ/exec'

# Google Sheets 客戶端（使用服務帳號或 API Key）
gspread_client = None

def init_gspread_client():
    """
    初始化 Google Sheets 客戶端
    優先使用服務帳號，如果沒有則使用 CSV 導出方式
    """
    global gspread_client
    try:
        # 嘗試使用服務帳號認證
        if os.path.exists('service-account.json'):
            creds = Credentials.from_service_account_file(
                'service-account.json',
                scopes=['https://www.googleapis.com/auth/spreadsheets']
            )
            gspread_client = gspread.authorize(creds)
            print('✅ Google Sheets 客戶端初始化成功（服務帳號）')
        else:
            print('⚠️  未找到 service-account.json，將使用 CSV 導出方式')
            gspread_client = None
    except Exception as e:
        print(f'⚠️  Google Sheets 客戶端初始化失敗: {str(e)}')
        gspread_client = None

# 初始化 Google Sheets 客戶端
init_gspread_client()

# API Key 輪替機制
api_keys_list = []
current_key_index = 0
api_key_lock = threading.Lock()

def load_api_keys():
    """載入並過濾有效的 API Keys"""
    global api_keys_list
    try:
        # 優先從 api_keys.json 載入
        if os.path.exists('api_keys.json'):
            with open('api_keys.json', 'r', encoding='utf-8') as f:
                data = json.load(f)
                # 過濾掉空的 key
                api_keys_list = [item['key'] for item in data.get('api_keys', []) if item.get('key', '').strip()]
                if api_keys_list:
                    print(f'✅ 已載入 {len(api_keys_list)} 個有效的 API Keys')
                    return True
        
        # 如果 api_keys.json 不存在或為空，嘗試從 config.json 載入
        if os.path.exists('config.json'):
            with open('config.json', 'r', encoding='utf-8') as f:
                config = json.load(f)
                key = config.get('gemini_api_key', '').strip()
                if key:
                    api_keys_list = [key]
                    print('✅ 從 config.json 載入 1 個 API Key')
                    return True
        
        print('⚠️  警告：未找到有效的 API Keys')
        return False
    
    except Exception as e:
        print(f'❌ 載入 API Keys 失敗: {str(e)}')
        return False

def get_next_api_key():
    """輪流取得下一個 API Key（Thread-safe）"""
    global current_key_index
    
    if not api_keys_list:
        return None
    
    with api_key_lock:
        key = api_keys_list[current_key_index]
        current_key_index = (current_key_index + 1) % len(api_keys_list)
        return key

def get_gemini_model_with_retry(max_retries=None):
    """
    取得配置好的 Gemini Model（使用輪替的 API Key，支援自動重試）
    max_retries: 最大重試次數，None 表示嘗試所有可用的 keys
    """
    if not api_keys_list:
        return None
    
    # 如果沒有指定 max_retries，則嘗試所有可用的 keys
    if max_retries is None:
        max_retries = len(api_keys_list)
    
    # 從 config.json 讀取模型名稱
    model_name = 'gemini-1.5-flash'  # 預設使用 1.5-flash（穩定版本，配額較高）
    if os.path.exists('config.json'):
        with open('config.json', 'r', encoding='utf-8') as f:
            config = json.load(f)
            model_name = config.get('model_name', model_name)
    
    for attempt in range(max_retries):
        try:
            api_key = get_next_api_key()
            if not api_key:
                continue
            
            genai.configure(api_key=api_key)
            model = genai.GenerativeModel(model_name)
            
            # 記錄當前使用的 Key（僅顯示前8個字元）
            key_preview = api_key[:8] + '...' if len(api_key) > 8 else api_key
            print(f'🔑 使用 API Key: {key_preview} (嘗試 {attempt + 1}/{max_retries})')
            
            return model
        
        except Exception as e:
            print(f'⚠️ API Key 失敗 (嘗試 {attempt + 1}/{max_retries}): {str(e)[:100]}')
            if attempt < max_retries - 1:
                continue
            else:
                print(f'❌ 所有 API Keys 都已嘗試，仍然失敗')
                return None
    
    return None

def get_gemini_model():
    """取得配置好的 Gemini Model（使用輪替的 API Key）- 簡化版本"""
    return get_gemini_model_with_retry(max_retries=1)

# 載入配置
gemini_model = None
try:
    if load_api_keys():
        # 測試第一個 key 是否可用
        gemini_model = get_gemini_model()
        if gemini_model:
            print('✅ Gemini API 初始化成功（輪替模式）')
        else:
            print('⚠️  警告：Gemini API 初始化失敗')
    else:
        print('⚠️  警告：無法載入 Gemini API 配置')
except Exception as e:
    print(f'⚠️  警告：無法載入 Gemini API 配置: {str(e)}')
    gemini_model = None

# 模擬後端狀態（實際應用中可能會用資料庫）
backend_status = {
    'browser_ready': True,
    'user_tab_ready': True,
    'last_check': datetime.now()
}

# 安全執行配置
EXECUTION_TIMEOUT = 5  # 5秒執行超時
MAX_OUTPUT_LENGTH = 10000  # 最大輸出長度

# 允許的內建函數白名單
SAFE_BUILTINS = {
    'print': print,
    'len': len,
    'str': str,
    'int': int,
    'float': float,
    'bool': bool,
    'list': list,
    'dict': dict,
    'tuple': tuple,
    'set': set,
    'range': range,
    'enumerate': enumerate,
    'zip': zip,
    'sum': sum,
    'min': min,
    'max': max,
    'abs': abs,
    'round': round,
    'sorted': sorted,
    'reversed': reversed,
    'type': type,
    'isinstance': isinstance,
    'hasattr': hasattr,
    'getattr': getattr,
    'chr': chr,
    'ord': ord,
    'bin': bin,
    'hex': hex,
    'oct': oct,
    'pow': pow,
    'divmod': divmod,
    'all': all,
    'any': any,
    'filter': filter,
    'map': map,
    # 數學函數
    'complex': complex,
    # 添加安全的 __import__ 實現
    '__import__': __import__,  # 我們會用自定義的安全版本替換
    # 不包含危險函數: open, exec, eval, compile, globals, locals, vars, dir
}

# 允許的模組白名單
ALLOWED_MODULES = {
    'math',
    'random',
    'datetime',
    'decimal',
    'fractions',
    'statistics',
    'string',
    'json',
    're'  # 正則表達式，但會限制某些功能
}

# 危險的 AST 節點類型
DANGEROUS_NODES = {
    # ast.Import,      # 移除，改為檢查模組名稱
    # ast.ImportFrom,  # 移除，改為檢查模組名稱 
    ast.Global,      # global 語句
    ast.Nonlocal,    # nonlocal 語句
}

# 危險的函數名稱
DANGEROUS_FUNCTIONS = {
    'open', 'file', 'raw_input',  # input 已移除，改用安全包裝
    'exec', 'eval', 'compile',
    'globals', 'locals', 'vars', 'dir',
    'setattr', 'delattr',
    'exit', 'quit', 'help', 'license', 'credits',
    'reload', 'execfile'
    # 移除 '__import__' 和 'getattr', 'hasattr' 因為我們需要它們
}

def safe_import(name, globals=None, locals=None, fromlist=(), level=0):
    """
    安全的模組導入函數，只允許導入白名單中的模組
    """
    if name not in ALLOWED_MODULES:
        raise ImportError(f"不允許導入模組: {name}")
    
    # 使用原始的 __import__ 導入允許的模組
    return __builtins__.__import__(name, globals, locals, fromlist, level)

def create_safe_input(input_queue):
    """
    創建安全的 input 函數，從預先提供的輸入佇列中讀取
    """
    input_index = [0]  # 使用列表來保持可變性
    
    def safe_input(prompt=''):
        if input_index[0] >= len(input_queue):
            raise EOFError('沒有更多輸入資料')
        value = input_queue[input_index[0]]
        input_index[0] += 1
        # 如果有提示訊息，也輸出它（模擬真實 input 行為）
        if prompt:
            print(prompt, end='')
        print(value)  # 輸出輸入的值（模擬使用者輸入）
        return value
    
    return safe_input

def validate_code_safety(code):
    """
    檢查程式碼是否安全
    返回 (is_safe, error_message)
    """
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return False, f"語法錯誤: {str(e)}"
    
    for node in ast.walk(tree):
        # 檢查導入語句
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name not in ALLOWED_MODULES:
                    return False, f"不允許導入模組: {alias.name}"
        elif isinstance(node, ast.ImportFrom):
            if node.module and node.module not in ALLOWED_MODULES:
                return False, f"不允許導入模組: {node.module}"
        
        # 檢查其他危險的節點類型
        elif type(node) in DANGEROUS_NODES:
            return False, f"不允許使用: {type(node).__name__}"
        
        # 檢查函數調用
        elif isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name):
                func_name = node.func.id
                if func_name in DANGEROUS_FUNCTIONS:
                    return False, f"不允許使用函數: {func_name}"
        
        # 檢查屬性存取
        elif isinstance(node, ast.Attribute):
            # 阻止存取某些危險屬性
            dangerous_attrs = {'__globals__', '__locals__', '__builtins__', '__file__', '__name__'}
            if node.attr in dangerous_attrs:
                return False, f"不允許存取屬性: {node.attr}"
    
    return True, None

def execute_with_timeout(code, timeout=EXECUTION_TIMEOUT, inputs=None):
    """
    在限定時間內執行程式碼
    inputs: 可選的輸入列表，用於 input() 函數
    """
    result = {'output': '', 'error': None, 'timeout': False}
    
    # 如果沒有提供輸入，使用空列表
    if inputs is None:
        inputs = []
    
    def target():
        try:
            # 創建安全的執行環境
            safe_globals = {
                '__builtins__': SAFE_BUILTINS.copy(),
                '__name__': '__main__',
            }
            # 使用我們的安全導入函數
            safe_globals['__builtins__']['__import__'] = safe_import
            # 添加安全的 input 函數
            safe_globals['__builtins__']['input'] = create_safe_input(inputs)
            
            safe_locals = {}
            
            # 重新導向輸出
            output_buffer = io.StringIO()
            error_buffer = io.StringIO()
            
            with contextlib.redirect_stdout(output_buffer), contextlib.redirect_stderr(error_buffer):
                exec(code, safe_globals, safe_locals)
            
            output = output_buffer.getvalue()
            errors = error_buffer.getvalue()
            
            # 限制輸出長度
            if len(output) > MAX_OUTPUT_LENGTH:
                output = output[:MAX_OUTPUT_LENGTH] + '\n...(輸出被截斷)'
            
            if errors:
                output = output + '\n' + errors if output else errors
            
            result['output'] = output if output else '(程式執行成功，無輸出)'
            
        except Exception as e:
            result['error'] = str(e)
    
    thread = threading.Thread(target=target)
    thread.daemon = True
    thread.start()
    thread.join(timeout)
    
    if thread.is_alive():
        result['timeout'] = True
        result['error'] = f'程式執行超時 ({timeout} 秒)，可能存在無限迴圈'
        # 注意：Python 的 threading 無法強制終止線程，這是一個限制
    
    return result

@app.route('/api/execute', methods=['POST'])
def execute_code():
    """
    接收前端傳來的 Python 程式碼並在安全環境中執行
    支援提供輸入資料給 input() 函數
    """
    try:
        data = request.get_json()
        code = data.get('code', '')
        inputs = data.get('inputs', [])  # 取得輸入資料列表
        
        if not code:
            return jsonify({
                'success': False,
                'error': '沒有收到程式碼'
            })
        
        # 基本長度檢查
        if len(code) > 50000:  # 50KB 限制
            return jsonify({
                'success': False,
                'error': '程式碼過長，請縮減程式碼長度'
            })
        
        # 驗證輸入資料
        if not isinstance(inputs, list):
            return jsonify({
                'success': False,
                'error': 'inputs 必須是列表格式'
            })
        
        # 限制輸入數量和長度
        if len(inputs) > 100:
            return jsonify({
                'success': False,
                'error': '輸入資料過多（最多 100 個）'
            })
        
        for inp in inputs:
            if not isinstance(inp, str) or len(inp) > 1000:
                return jsonify({
                    'success': False,
                    'error': '每個輸入必須是字串且不超過 1000 字元'
                })
        
        # 安全性檢查
        is_safe, safety_error = validate_code_safety(code)
        if not is_safe:
            return jsonify({
                'success': False,
                'error': f'安全檢查失敗: {safety_error}'
            })
        
        # 在安全環境中執行程式碼（傳入輸入資料）
        execution_result = execute_with_timeout(code, inputs=inputs)
        
        if execution_result['timeout']:
            return jsonify({
                'success': False,
                'error': execution_result['error']
            })
        elif execution_result['error']:
            return jsonify({
                'success': False,
                'error': execution_result['error']
            })
        else:
            return jsonify({
                'success': True,
                'output': execution_result['output']
            })
            
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'伺服器錯誤: {str(e)}'
        })

@app.route('/api/validate', methods=['POST'])
def validate_code():
    """
    檢查程式碼安全性但不執行
    """
    try:
        data = request.get_json()
        code = data.get('code', '')
        
        if not code:
            return jsonify({
                'success': False,
                'error': '沒有收到程式碼'
            })
        
        # 安全性檢查
        is_safe, safety_error = validate_code_safety(code)
        
        return jsonify({
            'success': is_safe,
            'message': '程式碼安全性檢查通過' if is_safe else f'安全檢查失敗: {safety_error}',
            'error': safety_error if not is_safe else None
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'伺服器錯誤: {str(e)}'
        })

@app.route('/api/ai/analyze', methods=['POST'])
def ai_analyze_code():
    """
    使用 Gemini AI 分析程式碼品質並給出建議（結構化輸出）
    """
    try:
        if not api_keys_list:
            return jsonify({
                'success': False,
                'error': 'Gemini API 未初始化，請檢查 api_keys.json 或 config.json'
            })
        
        # 取得輪替的 model（自動嘗試多個 keys）
        model = get_gemini_model_with_retry(max_retries=min(5, len(api_keys_list)))
        if not model:
            return jsonify({
                'success': False,
                'error': f'所有 API Keys 都超過配額或失敗，請稍後再試（共嘗試了 {min(5, len(api_keys_list))} 個 Keys）'
            })
        
        data = request.get_json()
        code = data.get('code', '')
        output = data.get('output', '')
        expected_output = data.get('expected_output', '')
        question = data.get('question', '')
        custom_prompt = data.get('custom_prompt', None)  # 🧪 自訂提示詞（測試用）
        
        if not code:
            return jsonify({
                'success': False,
                'error': '沒有收到程式碼'
            })
        
        # 定義結構化輸出 schema
        response_schema = {
            "type": "object",
            "properties": {
                "feedback": {
                    "type": "string",
                    "description": "針對程式的整體評語和建議"
                },
                "overall_score": {
                    "type": "integer",
                    "description": "程式整體評分 (0-100)"
                },
                "time_complexity_score": {
                    "type": "integer",
                    "description": "時間複雜度評分 (0-10)，評估演算法執行效率"
                },
                "space_complexity_score": {
                    "type": "integer",
                    "description": "空間複雜度評分 (0-10)，評估記憶體使用效率"
                },
                "readability_score": {
                    "type": "integer",
                    "description": "程式易讀性評分 (0-10)，評估變數命名、註解、程式碼風格"
                },
                "stability_score": {
                    "type": "integer",
                    "description": "程式穩定性評分 (0-10)，評估錯誤處理和邊界條件"
                }
            },
            "required": ["feedback", "overall_score", "time_complexity_score", "space_complexity_score", "readability_score", "stability_score"]
        }
        
        # 構建 AI 分析提示
        # 🧪 如果有自訂提示詞（測試模式），優先使用自訂提示詞
        if custom_prompt:
            prompt_template = custom_prompt
            print('🧪 使用前端傳來的自訂提示詞（測試模式）')
        else:
            # 從 prompts.json 載入
            prompt_template = prompts_config.get('analyze_prompt', {}).get('template', '')
        
        if not prompt_template:
            # 如果載入失敗，使用預設提示詞
            prompt_template = """你是一位專業的 Python 程式教學專家。請全面分析以下學生的程式碼：

【題目要求】
{question}

【學生程式碼】
```python
{code}
```

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

請用繁體中文回覆，並確保評分合理反映程式品質。"""
        
        prompt = prompt_template.format(
            question=question if question else '請撰寫一個 Python 程式，輸出指定的文字內容。',
            code=code,
            output=output if output else '(尚未執行)',
            expected_output=expected_output if expected_output else '(未提供)'
        )
        
        # 使用結構化輸出呼叫 Gemini API
        generation_config = genai.GenerationConfig(
            response_mime_type="application/json",
            response_schema=response_schema
        )
        
        try:
            response = model.generate_content(
                prompt,
                generation_config=generation_config
            )
            
            # 解析 JSON 回應
            analysis = json.loads(response.text)
            
            return jsonify({
                'success': True,
                'analysis': analysis
            })
        
        except Exception as api_error:
            # 檢查是否為配額錯誤
            error_msg = str(api_error)
            if '429' in error_msg or 'quota' in error_msg.lower() or 'rate limit' in error_msg.lower():
                print(f"⚠️ API Key 配額已滿，嘗試下一個 Key...")
                # 再試一次不同的 Key
                model = get_gemini_model_with_retry(max_retries=min(3, len(api_keys_list)))
                if model:
                    try:
                        response = model.generate_content(
                            prompt,
                            generation_config=generation_config
                        )
                        analysis = json.loads(response.text)
                        return jsonify({
                            'success': True,
                            'analysis': analysis
                        })
                    except Exception as retry_error:
                        print(f"❌ 重試後仍失敗: {str(retry_error)}")
            
            raise api_error
        
    except Exception as e:
        import traceback
        print(f"❌ AI 分析錯誤: {str(e)}")
        print(traceback.format_exc())
        
        # 提供更友善的錯誤訊息
        error_msg = str(e)
        if '429' in error_msg or 'quota' in error_msg.lower():
            return jsonify({
                'success': False,
                'error': f'所有 API Keys 都已達到配額限制，請稍後再試（約1分鐘後）'
            })
        else:
            return jsonify({
                'success': False,
                'error': f'AI 分析失敗: {error_msg[:200]}'
            })

@app.route('/api/ai/check', methods=['POST'])
def ai_check_code():
    """
    快速 AI 檢查：比對輸出並給分
    """
    try:
        if not api_keys_list:
            return jsonify({
                'success': False,
                'error': 'Gemini API 未初始化'
            })
        
        # 取得輪替的 model（自動嘗試多個 keys）
        model = get_gemini_model_with_retry(max_retries=min(3, len(api_keys_list)))
        if not model:
            return jsonify({
                'success': False,
                'error': '所有 API Keys 都超過配額，請稍後再試'
            })
        
        data = request.get_json()
        code = data.get('code', '')
        output = data.get('output', '')
        expected_output = data.get('expected_output', '')
        
        # 從 prompts.json 載入提示詞
        prompt_template = prompts_config.get('check_prompt', {}).get('template', '')
        if not prompt_template:
            # 預設提示詞
            prompt_template = """快速檢查這段 Python 程式：

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
{{
    "match": true/false,
    "score": 85,
    "differences": ["差異1", "差異2"]
}}
"""
        
        prompt = prompt_template.format(
            code=code,
            output=output,
            expected_output=expected_output
        )
        
        response = model.generate_content(prompt)
        ai_response = response.text
        
        try:
            if '```json' in ai_response:
                ai_response = ai_response.split('```json')[1].split('```')[0].strip()
            elif '```' in ai_response:
                ai_response = ai_response.split('```')[1].split('```')[0].strip()
            
            result = json.loads(ai_response)
        except:
            result = {
                "match": False,
                "score": 50,
                "differences": ["無法解析 AI 回應"]
            }
        
        return jsonify({
            'success': True,
            'result': result
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'AI 檢查失敗: {str(e)}'
        })

@app.route('/api/ai/suggest', methods=['POST'])
def ai_suggest_improvement():
    """
    AI 建議改進方向
    """
    try:
        if not api_keys_list:
            return jsonify({
                'success': False,
                'error': 'Gemini API 未初始化'
            })
        
        # 取得輪替的 model（自動嘗試多個 keys）
        model = get_gemini_model_with_retry(max_retries=min(3, len(api_keys_list)))
        if not model:
            return jsonify({
                'success': False,
                'error': '所有 API Keys 都超過配額，請稍後再試'
            })
        
        data = request.get_json()
        code = data.get('code', '')
        stats = data.get('stats', {})
        output = data.get('output', '')
        score = data.get('score', None)
        
        # 從 prompts.json 載入提示詞
        prompt_template = prompts_config.get('suggest_prompt', {}).get('template', '')
        if not prompt_template:
            # 預設提示詞
            prompt_template = """你是一位專業且親切的程式設計老師，使用「引導式學習」教導學生寫程式。

【教學規則】
1. 不直接給完整答案，先用問題與提示一步步引導學生自己思考
2. 每次回覆時，都要先肯定學生的一小部分（例如：哪段想法是對的、哪裡寫得不錯）
3. 根據學生的程式碼，說明目前狀況是否正確，若有錯誤，用簡單的話說明問題點，並給 1～3 個提示讓學生自己修正
4. 在回覆結尾，一定要主動提出 3～5 個相關且能深化理解的「後續問題」，格式為 Q1、Q2、Q3...
5. 回覆語氣友善、清楚，用繁體中文（台灣用語），讓學生感到被支持、陪伴，而不是被糾正

【當前教學情境】
學生得分：{score}

程式碼內容：
```python
{code}
```

執行結果：
{output}

學習統計：
- 執行次數：{run_count}
- 錯誤次數：{error_count}
- 成功率：{success_rate}%
- 修改次數：{modifications}
在回覆結尾，一定要主動提出 3～5 個相關且能深化理解的「後續問題」，格式為 Q1、Q2、Q3...
"""
        
        prompt = prompt_template.format(
            score=score if score else '尚未評分',
            code=code if code else '(尚未撰寫程式碼)',
            output=output if output else '(尚未執行)',
            run_count=stats.get('run_count', 0),
            error_count=stats.get('error_count', 0),
            success_rate=stats.get('success_rate', 0),
            modifications=stats.get('modifications', 0)
        )
        
        # 🎨 自動添加 Markdown 格式指示
        prompt += "\n\n**重要格式要求**：請使用 Markdown 格式回覆，包括標題(##)、粗體(**文字**)、列表(-)、程式碼區塊(```python)等，讓回覆更易讀。\n"
        
        response = model.generate_content(prompt)
        ai_response = response.text
        
        try:
            if '```json' in ai_response:
                ai_response = ai_response.split('```json')[1].split('```')[0].strip()
            elif '```' in ai_response:
                ai_response = ai_response.split('```')[1].split('```')[0].strip()
            
            suggestions = json.loads(ai_response)
        except:
            suggestions = {
                "affirmation": "很好！你已經開始嘗試寫程式了，這是很棒的第一步。",
                "current_status": "目前程式碼還需要一些調整，讓我們一起來看看可以怎麼改進。",
                "hints": ["先想想程式的基本架構需要哪些部分", "檢查一下語法是否正確", "試著執行看看，觀察錯誤訊息"],
                "follow_up_questions": [
                    "Q1 你知道這個程式的目標是什麼嗎？",
                    "Q2 你覺得目前的程式碼缺少了什麼？",
                    "Q3 如果執行出現錯誤，你會怎麼找出問題？"
                ]
            }
        
        return jsonify({
            'success': True,
            'suggestions': suggestions
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'AI 建議失敗: {str(e)}'
        })

@app.route('/api/ai/chat', methods=['POST'])
def ai_chat():
    """
    AI 對話機器人（流式輸出）
    包含完整的系統提示詞：題目要求、當前程式碼、執行結果、上次評分等
    """
    try:
        if not api_keys_list:
            return jsonify({
                'success': False,
                'error': 'Gemini API 未初始化'
            })
        
        # 取得輪替的 model
        model = get_gemini_model_with_retry(max_retries=min(3, len(api_keys_list)))
        if not model:
            return jsonify({
                'success': False,
                'error': '所有 API Keys 都超過配額，請稍後再試'
            })
        
        data = request.get_json()
        user_message = data.get('student_question', data.get('message', ''))
        custom_prompt = data.get('custom_prompt', None)  # 🧪 自訂提示詞（測試用）
        
        # 獲取完整的上下文資訊
        question_info = data.get('question', '')
        current_code = data.get('student_code', data.get('current_code', ''))
        current_output = data.get('execution_result', data.get('current_output', ''))
        last_score = data.get('last_ai_score', data.get('last_score', None))
        last_score_code = data.get('last_score_code', '')
        last_score_output = data.get('last_score_output', '')
        stats = data.get('stats', {})
        
        # 構建引導式學習的系統提示詞
        # 🧪 如果有自訂提示詞（測試模式），直接使用自訂提示詞作為完整上下文
        if custom_prompt:
            print('🧪 使用前端傳來的自訂 chat 提示詞（測試模式）')
            # 將上下文資訊格式化後插入自訂提示詞
            context_data = {
                'question_info': f"{question_info.get('title', '')}\n{question_info.get('description', '')}" if isinstance(question_info, dict) else str(question_info),
                'current_code': current_code if current_code else '(尚未撰寫程式碼)',
                'current_output': current_output if current_output else '(尚未執行)',
                'user_message': user_message
            }
            system_context = custom_prompt.format(**context_data)
        else:
            # 從 prompts.json 載入
            chat_prompt_config = prompts_config.get('chat_system_prompt', {})
            base_rules = chat_prompt_config.get('base_rules', '')
            context_sections = chat_prompt_config.get('context_sections', {})
            
            # 如果載入失敗，使用預設值
            if not base_rules:
                base_rules = """你是一位專業且親切的程式設計老師，使用「引導式學習」教導學生寫程式。

【教學規則】
1. 不直接給完整答案，先用問題與提示一步步引導學生自己思考
2. 每次回覆時，都要先肯定學生的一小部分（例如：哪段想法是對的、哪裡寫得不錯）
3. 根據學生的程式碼，說明目前狀況是否正確，若有錯誤，用簡單的話說明問題點，並給 1～3 個提示讓學生自己修正
4. 在回覆結尾，一定要主動提出 3～5 個相關且能深化理解的「後續問題」，格式為 Q1、Q2、Q3...
5. 回覆語氣友善、清楚，用繁體中文（台灣用語），讓學生感到被支持、陪伴，而不是被糾正
6. 除非學生明確要求「請直接給我完整答案」，否則不要一次貼出完整解答程式碼，只能貼關鍵片段或偽碼做提示

"""
                context_sections = {
                    "question": "【當前題目】\n{question_info}\n\n",
                    "current_code": "【學生當前程式碼】\n```python\n{current_code}\n```\n\n",
                    "current_code_empty": "【學生當前程式碼】\n(尚未撰寫程式碼)\n\n",
                    "current_output": "【當前執行結果】\n{current_output}\n\n",
                    "current_output_empty": "【當前執行結果】\n(尚未執行)\n\n",
                    "last_score": "【上次 AI 評分】\n總分：{overall}/100\n- 時間複雜度：{time_complexity}/10\n- 空間複雜度：{space_complexity}/10\n- 可讀性：{readability}/10\n- 穩定性：{stability}/10\n\n",
                    "last_score_empty": "【上次 AI 評分】\n尚未評分\n\n",
                    "last_score_code": "【上次評分時的程式碼】\n```python\n{last_score_code}\n```\n\n",
                    "last_score_output": "【上次評分時的執行結果】\n{last_score_output}\n\n",
                    "stats": "【學習統計】\n- 執行次數：{run_count}\n- 錯誤次數：{error_count}\n- 成功率：{success_rate}%\n- 修改次數：{modifications}\n\n",
                    "user_message": "【學生問題】\n{user_message}\n\n",
                    "final_instruction": "請依照「教學規則」回答，用友善且引導式的方式幫助學生思考和學習。記得在回覆結尾提出 3～5 個後續問題（Q1、Q2、Q3...）。"
                }
            
            system_context = base_rules
            
            # 1. 題目要求
            if question_info:
                if isinstance(question_info, dict):
                    # 舊格式（字典）- 合併標題和描述
                    question_text = f"標題：{question_info.get('title', '')}\n要求：{question_info.get('description', '')}"
                    system_context += context_sections.get('question', '【當前題目】\n{question_info}\n\n').format(question_info=question_text)
                elif isinstance(question_info, str):
                    # 新格式（字串）
                    system_context += context_sections.get('question', '【當前題目】\n{question_info}\n\n').format(question_info=question_info)
            
            # 2. 當前程式碼內容
            if current_code:
                system_context += context_sections.get('current_code', '【學生當前程式碼】\n```python\n{current_code}\n```\n\n').format(current_code=current_code)
            else:
                system_context += context_sections.get('current_code_empty', '【學生當前程式碼】\n(尚未撰寫程式碼)\n\n')
            
            # 3. 當前執行結果
            if current_output:
                system_context += context_sections.get('current_output', '【當前執行結果】\n{current_output}\n\n').format(current_output=current_output)
            else:
                system_context += context_sections.get('current_output_empty', '【當前執行結果】\n(尚未執行)\n\n')
            
            # 4. 上一次 AI 評分結果
            if last_score:
                system_context += context_sections.get('last_score', '【上次 AI 評分】\n總分：{overall}/100\n- 時間複雜度：{time_complexity}/10\n- 空間複雜度：{space_complexity}/10\n- 可讀性：{readability}/10\n- 穩定性：{stability}/10\n\n').format(
                    overall=last_score.get('overall', 'N/A'),
                    time_complexity=last_score.get('time_complexity', 'N/A'),
                    space_complexity=last_score.get('space_complexity', 'N/A'),
                    readability=last_score.get('readability', 'N/A'),
                    stability=last_score.get('stability', 'N/A')
                )
            else:
                system_context += context_sections.get('last_score_empty', '【上次 AI 評分】\n尚未評分\n\n')
            
            # 5. 上一次評分時的程式碼
            if last_score_code:
                system_context += context_sections.get('last_score_code', '【上次評分時的程式碼】\n```python\n{last_score_code}\n```\n\n').format(last_score_code=last_score_code)
            
            # 6. 上一次評分時的執行結果
            if last_score_output:
                system_context += context_sections.get('last_score_output', '【上次評分時的執行結果】\n{last_score_output}\n\n').format(last_score_output=last_score_output)
            
            # 7. 學習統計
            if stats:
                system_context += context_sections.get('stats', '【學習統計】\n- 執行次數：{run_count}\n- 錯誤次數：{error_count}\n- 成功率：{success_rate}%\n- 修改次數：{modifications}\n\n').format(
                    run_count=stats.get('run_count', 0),
                    error_count=stats.get('error_count', 0),
                    success_rate=stats.get('success_rate', 0),
                    modifications=stats.get('modifications', 0)
                )
            
            # 最後加上學生問題
            system_context += context_sections.get('user_message', '【學生問題】\n{user_message}\n\n').format(user_message=user_message)
            system_context += context_sections.get('final_instruction', '請依照「教學規則」回答，用友善且引導式的方式幫助學生思考和學習。記得在回覆結尾提出 3～5 個後續問題（Q1、Q2、Q3...）。')
        
        # 🎨 自動添加 Markdown 格式指示（不修改提示詞文件）
        system_context += "\n\n**重要格式要求**：請使用 Markdown 格式回覆，包括：\n"
        system_context += "- 使用 `##` 或 `###` 建立標題和子標題\n"
        system_context += "- 使用 `**粗體**` 強調重點\n"
        system_context += "- 使用 `- ` 或 `1. ` 建立清單\n"
        system_context += "- 使用 `` `code` `` 標記行內程式碼\n"
        system_context += "- 使用 ```python 程式碼區塊標記多行程式碼\n"
        system_context += "- 使用 `>` 建立引用區塊\n"
        system_context += "- 適當使用表格來呈現評分或比較資訊\n"
        system_context += "讓回覆更易讀、更有結構，類似 ChatGPT 的風格。\n"
        
        # 使用流式輸出
        def generate():
            try:
                response = model.generate_content(
                    system_context,
                    stream=True
                )
                
                for chunk in response:
                    if chunk.text:
                        # 發送 Server-Sent Events 格式
                        yield f"data: {json.dumps({'text': chunk.text})}\n\n"
                
                yield "data: [DONE]\n\n"
                
            except Exception as e:
                yield f"data: {json.dumps({'error': str(e)})}\n\n"
        
        return Response(
            generate(),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'X-Accel-Buffering': 'no'
            }
        )
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'對話失敗: {str(e)}'
        })

@app.route('/api/questions', methods=['GET'])
def get_questions():
    """
    獲取所有題目列表
    支援快取機制
    """
    global questions_cache, questions_last_fetch
    
    try:
        # 檢查快取是否有效
        now = datetime.now()
        if questions_cache and questions_last_fetch:
            time_diff = (now - questions_last_fetch).total_seconds() / 60
            if time_diff < CACHE_EXPIRE_MINUTES:
                return jsonify({
                    'success': True,
                    'questions': questions_cache,
                    'cached': True,
                    'cache_age_minutes': round(time_diff, 1)
                })
        
        # 嘗試從 Google Sheets 讀取
        questions = fetch_questions_from_sheet()
        
        if questions:
            questions_cache = questions
            questions_last_fetch = now
            return jsonify({
                'success': True,
                'questions': questions,
                'cached': False
            })
        else:
            # 如果讀取失敗，嘗試從本地 JSON 讀取
            if os.path.exists('questions.json'):
                with open('questions.json', 'r', encoding='utf-8') as f:
                    questions = json.load(f)
                    return jsonify({
                        'success': True,
                        'questions': questions,
                        'from_file': True
                    })
            else:
                return jsonify({
                    'success': False,
                    'error': '無法讀取題目資料'
                })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'獲取題目失敗: {str(e)}'
        })

@app.route('/api/questions/<question_id>', methods=['GET'])
def get_question_by_id(question_id):
    """
    根據 ID 獲取單一題目
    """
    try:
        # 先獲取所有題目
        global questions_cache
        
        if not questions_cache:
            questions = fetch_questions_from_sheet()
            if questions:
                questions_cache = questions
            elif os.path.exists('questions.json'):
                with open('questions.json', 'r', encoding='utf-8') as f:
                    questions_cache = json.load(f)
        
        if not questions_cache:
            return jsonify({
                'success': False,
                'error': '無法讀取題目資料'
            })
        
        # 查找指定 ID 的題目
        question = None
        for q in questions_cache:
            if str(q.get('id')) == str(question_id):
                question = q
                break
        
        if question:
            return jsonify({
                'success': True,
                'question': question
            })
        else:
            return jsonify({
                'success': False,
                'error': f'找不到題目 ID: {question_id}'
            })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'獲取題目失敗: {str(e)}'
        })

@app.route('/api/questions/refresh', methods=['POST'])
def refresh_questions():
    """
    強制重新從 Google Sheets 載入題目
    """
    global questions_cache, questions_last_fetch
    
    try:
        questions = fetch_questions_from_sheet()
        
        if questions:
            questions_cache = questions
            questions_last_fetch = datetime.now()
            
            # 同時儲存到本地
            with open('questions.json', 'w', encoding='utf-8') as f:
                json.dump(questions, f, ensure_ascii=False, indent=2)
            
            return jsonify({
                'success': True,
                'message': f'成功重新載入 {len(questions)} 道題目',
                'questions': questions
            })
        else:
            return jsonify({
                'success': False,
                'error': '無法從 Google Sheets 讀取題目'
            })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'重新載入失敗: {str(e)}'
        })

@app.route('/api/scores/submit', methods=['POST'])
def submit_score():
    """
    提交成績到 Google Sheets（包含詳細評分）
    """
    try:
        data = request.get_json()
        student_name = data.get('student_name', '')
        question_id = data.get('question_id', '')
        score = data.get('score', 0)
        code = data.get('code', '')
        detailed_scores = data.get('detailed_scores', {})
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        
        if not student_name or not question_id:
            return jsonify({
                'success': False,
                'error': '缺少學生姓名或題目 ID'
            })
        
        # 使用 HTTP 方式寫入（通過 Google Forms 或 Web App）
        # 由於直接寫入需要認證，我們先讀取現有資料，更新後寫回
        success = update_score_in_sheet(student_name, question_id, score, code, timestamp, detailed_scores)
        
        if success:
            return jsonify({
                'success': True,
                'message': '成績已記錄',
                'data': {
                    'student_name': student_name,
                    'question_id': question_id,
                    'score': score,
                    'detailed_scores': detailed_scores,
                    'timestamp': timestamp
                }
            })
        else:
            return jsonify({
                'success': False,
                'error': '成績記錄失敗，請稍後再試'
            })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'提交失敗: {str(e)}'
        })

@app.route('/api/scores/<student_name>', methods=['GET'])
def get_student_scores(student_name):
    """
    獲取學生的所有成績
    """
    try:
        scores = fetch_student_scores(student_name)
        
        if scores is not None:
            return jsonify({
                'success': True,
                'student_name': student_name,
                'scores': scores
            })
        else:
            return jsonify({
                'success': False,
                'error': '無法讀取成績資料'
            })
    
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'讀取失敗: {str(e)}'
        })

def update_score_in_sheet(student_name, question_id, score, code, timestamp, detailed_scores=None):
    """
    更新 Google Sheets 中的成績（保留最高分，包含詳細評分）
    使用 CSV 導出和 HTTP POST 方式
    """
    try:
        import requests
        import csv
        from io import StringIO
        
        # 1. 讀取現有資料
        response = requests.get(SCORES_SHEET_URL, timeout=10)
        response.encoding = 'utf-8'
        
        if response.status_code != 200:
            print(f"❌ 無法讀取成績表: HTTP {response.status_code}")
            # 如果無法讀取，嘗試直接寫入（使用 Google Apps Script Web App）
            return write_score_via_webapp(student_name, question_id, score, code, timestamp, detailed_scores)
        
        # 2. 解析 CSV
        csv_data = StringIO(response.text)
        reader = csv.reader(csv_data)
        rows = list(reader)
        
        if len(rows) == 0:
            # 空表格，創建標題行
            rows = [['學生姓名', '題目ID', '題目標題', '總分', '時間複雜度', '空間複雜度', '易讀性', '穩定性', '提交時間', '程式碼']]
        
        # 3. 查找該學生該題目的現有記錄
        updated = False
        for i, row in enumerate(rows[1:], start=1):  # 跳過標題行
            if len(row) >= 2 and row[0] == student_name and row[1] == question_id:
                # 找到現有記錄，比較分數
                existing_score = int(row[3]) if len(row) > 3 and row[3].isdigit() else 0
                if score > existing_score:
                    # 更新為更高的分數
                    time_score = detailed_scores.get('time_complexity', 0) if detailed_scores else 0
                    space_score = detailed_scores.get('space_complexity', 0) if detailed_scores else 0
                    read_score = detailed_scores.get('readability', 0) if detailed_scores else 0
                    stab_score = detailed_scores.get('stability', 0) if detailed_scores else 0
                    
                    rows[i] = [student_name, question_id, get_question_title(question_id), 
                              str(score), str(time_score), str(space_score), str(read_score), str(stab_score),
                              timestamp, code[:100]]
                    updated = True
                    print(f"✅ 更新成績: {student_name} - 題目 {question_id}: {existing_score} -> {score}")
                else:
                    print(f"ℹ️  保留較高分數: {student_name} - 題目 {question_id}: {existing_score}")
                    return True
                break
        
        # 4. 如果沒有找到記錄，新增一行
        if not updated:
            time_score = detailed_scores.get('time_complexity', 0) if detailed_scores else 0
            space_score = detailed_scores.get('space_complexity', 0) if detailed_scores else 0
            read_score = detailed_scores.get('readability', 0) if detailed_scores else 0
            stab_score = detailed_scores.get('stability', 0) if detailed_scores else 0
            
            rows.append([student_name, question_id, get_question_title(question_id), 
                        str(score), str(time_score), str(space_score), str(read_score), str(stab_score),
                        timestamp, code[:100]])
            print(f"✅ 新增成績: {student_name} - 題目 {question_id}: {score}")
        
        # 5. 寫回 Google Sheets（使用 Web App 端點）
        return write_score_via_webapp(student_name, question_id, score, code, timestamp, detailed_scores)
        
    except Exception as e:
        print(f"❌ 更新成績失敗: {str(e)}")
        return False

def write_score_via_webapp(student_name, question_id, score, code, timestamp, detailed_scores=None):
    """
    通過 Google Apps Script Web App 寫入成績到 Google Sheets（包含詳細評分）
    同時備份到本地 JSON
    """
    try:
        import requests
        
        # 準備詳細評分
        time_score = detailed_scores.get('time_complexity', 0) if detailed_scores else 0
        space_score = detailed_scores.get('space_complexity', 0) if detailed_scores else 0
        read_score = detailed_scores.get('readability', 0) if detailed_scores else 0
        stab_score = detailed_scores.get('stability', 0) if detailed_scores else 0
        question_title = get_question_title(question_id)
        
        # 1. 嘗試寫入 Google Sheets
        try:
            payload = {
                'action': 'appendRow',
                'data': [
                    student_name,
                    question_id,
                    question_title,
                    str(score),
                    str(time_score),
                    str(space_score),
                    str(read_score),
                    str(stab_score),
                    timestamp,
                    code[:100]  # 只保存前100字元
                ]
            }
            
            response = requests.post(
                WEBAPP_URL,
                json=payload,
                timeout=10
            )
            
            if response.status_code == 200:
                result = response.json()
                if result.get('success'):
                    print(f"✅ 成績已寫入 Google Sheets: {student_name} - 題目 {question_id}: {score}")
                else:
                    print(f"⚠️ Google Sheets 寫入失敗: {result.get('message', '未知錯誤')}")
            else:
                print(f"⚠️ Google Sheets HTTP 錯誤: {response.status_code}")
        
        except Exception as sheet_error:
            print(f"⚠️ 無法寫入 Google Sheets: {str(sheet_error)}")
        
        # 2. 備份到本地 JSON（無論 Google Sheets 是否成功）
        scores_file = 'scores_backup.json'
        scores_data = []
        
        if os.path.exists(scores_file):
            with open(scores_file, 'r', encoding='utf-8') as f:
                scores_data = json.load(f)
        
        # 查找並更新或新增
        found = False
        for record in scores_data:
            if record['student_name'] == student_name and record['question_id'] == question_id:
                if score > record['score']:
                    record['score'] = score
                    record['timestamp'] = timestamp
                    record['code'] = code[:100]
                    record['time_complexity_score'] = time_score
                    record['space_complexity_score'] = space_score
                    record['readability_score'] = read_score
                    record['stability_score'] = stab_score
                    print(f"📝 本地備份已更新: {student_name} - 題目 {question_id}")
                found = True
                break
        
        if not found:
            new_record = {
                'student_name': student_name,
                'question_id': question_id,
                'question_title': question_title,
                'score': score,
                'time_complexity_score': time_score,
                'space_complexity_score': space_score,
                'readability_score': read_score,
                'stability_score': stab_score,
                'timestamp': timestamp,
                'code': code[:100]
            }
            scores_data.append(new_record)
            print(f"📝 本地備份已新增: {student_name} - 題目 {question_id}")
        
        with open(scores_file, 'w', encoding='utf-8') as f:
            json.dump(scores_data, f, ensure_ascii=False, indent=2)
        
        return True
        
    except Exception as e:
        print(f"❌ 寫入成績失敗: {str(e)}")
        return False

def fetch_student_scores(student_name):
    """
    獲取學生的所有成績
    """
    try:
        # 先嘗試從本地備份讀取
        scores_file = 'scores_backup.json'
        if os.path.exists(scores_file):
            with open(scores_file, 'r', encoding='utf-8') as f:
                all_scores = json.load(f)
                student_scores = [s for s in all_scores if s['student_name'] == student_name]
                return student_scores
        
        return []
        
    except Exception as e:
        print(f"❌ 讀取成績失敗: {str(e)}")
        return None

def get_question_title(question_id):
    """
    根據題目 ID 獲取題目標題
    """
    global questions_cache
    
    if questions_cache:
        for q in questions_cache:
            if str(q.get('id')) == str(question_id):
                return q.get('title', f'題目 {question_id}')
    
    return f'題目 {question_id}'



@app.route('/api/status', methods=['GET'])
def get_status():
    """
    獲取後端狀態
    """
    backend_status['last_check'] = datetime.now()
    return jsonify(backend_status)

@app.route('/api/restart', methods=['POST'])
def restart_backend():
    """
    重新啟動後端連接（模擬）
    """
    try:
        # 重置狀態
        backend_status['browser_ready'] = True
        backend_status['user_tab_ready'] = True
        backend_status['last_check'] = datetime.now()
        
        return jsonify({
            'success': True,
            'message': '後端已重新連接'
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        })

@app.route('/api/tabs', methods=['GET'])
def get_tabs():
    """
    獲取標籤頁列表（模擬）
    """
    return jsonify({
        'success': True,
        'tabs': []
    })

@app.route('/api/auto_start', methods=['POST'])
def auto_start():
    """
    自動啟動確認端點
    """
    return jsonify({
        'success': True,
        'message': '後端服務運行中'
    })

@app.route('/health', methods=['GET'])
@app.route('/api/health', methods=['GET'])
def health_check():
    """健康檢查端點 - 用於自動偵測 API 連接"""
    return jsonify({
        'status': 'running',
        'timestamp': datetime.now().isoformat()
    })

@app.route('/', methods=['GET'])
def index():
    """根路徑"""
    return jsonify({
        'service': 'Python 智能程式診斷平台 - 安全後端 API',
        'version': '3.2.0',
        'status': 'running',
        'ai_enabled': len(api_keys_list) > 0,
        'api_keys_count': len(api_keys_list),
        'security_features': [
            '程式碼安全性檢查',
            '執行時間限制',
            '輸出長度限制',
            '危險函數阻止',
            '模組導入限制'
        ],
        'ai_features': [
            'Gemini AI 程式碼分析',
            '智能評分系統',
            '個人化學習建議',
            '即時錯誤診斷',
            f'API Key 輪替機制 ({len(api_keys_list)} 個 Keys)'
        ] if api_keys_list else [],
        'endpoints': {
            'execute': '/api/execute (POST) - 安全執行 Python 程式碼',
            'validate': '/api/validate (POST) - 檢查程式碼安全性',
            'ai_analyze': '/api/ai/analyze (POST) - AI 分析程式碼',
            'ai_check': '/api/ai/check (POST) - AI 快速檢查',
            'ai_suggest': '/api/ai/suggest (POST) - AI 學習建議',
            'ai_chat': '/api/ai/chat (POST) - AI 對話機器人',
            'questions': '/api/questions (GET) - 獲取所有題目',
            'question_by_id': '/api/questions/<id> (GET) - 獲取單一題目',
            'refresh_questions': '/api/questions/refresh (POST) - 重新載入題目',
            'status': '/api/status (GET) - 獲取後端狀態',
            'restart': '/api/restart (POST) - 重新啟動服務',
            'tabs': '/api/tabs (GET) - 獲取標籤頁列表',
            'auto_start': '/api/auto_start (POST) - 自動啟動確認',
            'health': '/health (GET) - 健康檢查'
        }
    })

if __name__ == '__main__':
    print('=' * 60)
    print('🐍 Python 智能程式診斷平台 - AI 增強版 v3.2')
    print('=' * 60)
    print('✅ 伺服器啟動成功')
    print('📡 API 位址: http://localhost:5000')
    print('🌐 前端頁面: 請在瀏覽器中開啟 frontend/index.html')
    print('=' * 60)
    print('🤖 AI 功能:')
    if api_keys_list:
        print(f'  - ✓ Gemini AI 已啟用（{len(api_keys_list)} 個 API Keys）')
        print('  - ✓ API Key 自動輪替機制')
        print('  - ✓ 智能程式碼分析')
        print('  - ✓ 自動評分系統')
        print('  - ✓ 個人化學習建議')
    else:
        print('  - ✗ AI 功能未啟用（請檢查 api_keys.json 或 config.json）')
    print('=' * 60)
    print('� 題目系統:')
    print('  - ✓ 動態從 Google Sheets 讀取題目')
    print('  - ✓ 30 分鐘快取機制')
    print('  - ✓ 支援多題目管理')
    print('=' * 60)
    print('�🛡️ 安全功能:')
    print('  - ✓ 程式碼安全性檢查 (AST 分析)')
    print('  - ✓ 執行時間限制 (5秒超時)')
    print('  - ✓ 輸出長度限制 (10KB)')
    print('  - ✓ 危險函數阻止 (open, exec, eval 等)')
    print('  - ✓ 模組導入限制 (僅允許安全模組)')
    print('  - ✓ 內建函數白名單')
    print('=' * 60)
    print('📚 可用的 API 端點:')
    print('  - POST /api/execute           : 安全執行 Python 程式碼')
    print('  - POST /api/validate          : 檢查程式碼安全性')
    print('  - POST /api/ai/analyze        : AI 分析程式碼')
    print('  - POST /api/ai/check          : AI 快速檢查')
    print('  - POST /api/ai/suggest        : AI 學習建議')
    print('  - POST /api/ai/chat           : AI 對話機器人')
    print('  - GET  /api/questions         : 獲取所有題目')
    print('  - GET  /api/questions/<id>    : 獲取單一題目')
    print('  - POST /api/questions/refresh : 重新載入題目')
    print('  - GET  /api/status            : 獲取後端狀態')
    print('  - POST /api/restart           : 重新連接後端')
    print('  - POST /api/auto_start        : 自動啟動確認')
    print('  - GET  /health                : 健康檢查')
    print('=' * 60)
    print('⚠️  按 Ctrl+C 可停止伺服器')
    print('=' * 60)
    print()
    
    app.run(host='localhost', port=5000, debug=False, threaded=True)
