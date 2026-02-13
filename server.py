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
from openai import OpenAI
import os
import gspread
from google.oauth2.service_account import Credentials
import requests

app = Flask(__name__)
app.secret_key = secrets.token_hex(16)  # 生成隨機密鑰
CORS(app, supports_credentials=True)  # 允許跨域請求並支援 cookie

# 導入題目讀取器
from tool.fetch_questions import fetch_questions_from_sheet

# 載入提示詞配置
prompts_config = {}
try:
    if os.path.exists('tool/prompts.json'):
        with open('tool/prompts.json', 'r', encoding='utf-8') as f:
            prompts_config = json.load(f)
            print('[OK] 提示詞配置載入成功')
    else:
        print('[WARN] 警告：tool/prompts.json 不存在，將使用預設提示詞')
except Exception as e:
    print(f'[WARN] 警告：無法載入提示詞配置: {str(e)}')

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
            print('[OK] Google Sheets 客戶端初始化成功（服務帳號）')
        else:
            print('[WARN] 未找到 service-account.json，將使用 CSV 導出方式')
            gspread_client = None
    except Exception as e:
        print(f'[WARN] Google Sheets 客戶端初始化失敗: {str(e)}')
        gspread_client = None

# 初始化 Google Sheets 客戶端
init_gspread_client()

# OpenAI 配置
openai_api_key = None
openai_client = None

def load_openai_key():
    """載入 OpenAI API Key"""
    global openai_api_key
    try:
        # 優先從 api_keys.json 載入
        # 優先從 api_keys.json 載入 (已棄用，整合至 config.json)
        # if os.path.exists('api_keys.json'): ...
        
        # 嘗試從 config.json 載入
        if os.path.exists('config.json'):
            with open('config.json', 'r', encoding='utf-8') as f:
                config = json.load(f)
                key = config.get('openai_api_key', '').strip()
                if key:
                    openai_api_key = key
                    print('[OK] 從 config.json 載入 OpenAI API Key')
                    return True
        
        print('[WARN] 警告：未找到有效的 OpenAI API Key')
        return False
    
    except Exception as e:
        print(f'[ERROR] 載入 API Key 失敗: {str(e)}')
        return False

def init_openai_client():
    """初始化 OpenAI Client"""
    global openai_client, openai_api_key
    if openai_api_key:
        try:
            openai_client = OpenAI(api_key=openai_api_key)
            print('[OK] OpenAI Client 初始化成功')
            return True
        except Exception as e:
            print(f'[ERROR] OpenAI Client 初始化失敗: {str(e)}')
            return False
    return False

def get_model_name():
    """從配置獲取模型名稱"""
    model_name = 'gpt-4o-mini'  # 預設
    if os.path.exists('config.json'):
        try:
            with open('config.json', 'r', encoding='utf-8') as f:
                config = json.load(f)
                model_name = config.get('model_name', model_name)
        except:
            pass
    return model_name

# 載入配置
try:
    if load_openai_key():
        init_openai_client()
    else:
        print('[WARN] 警告：無法載入 OpenAI API 配置')
except Exception as e:
    print(f'[WARN] 警告：無法載入 OpenAI API 配置: {str(e)}')

# 模擬後端狀態
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
    '__import__': __import__,
}

# 允許的模組白名單
ALLOWED_MODULES = {
    'math', 'random', 'datetime', 'decimal', 'fractions', 'statistics', 'string', 'json', 're'
}

# 危險的 AST 節點類型
DANGEROUS_NODES = {
    ast.Global, ast.Nonlocal,
}

# 危險的函數名稱
DANGEROUS_FUNCTIONS = {
    'open', 'file', 'raw_input', 'exec', 'eval', 'compile',
    'globals', 'locals', 'vars', 'dir',
    'setattr', 'delattr', 'exit', 'quit', 'help', 'license', 'credits',
    'reload', 'execfile'
}

def safe_import(name, globals=None, locals=None, fromlist=(), level=0):
    if name not in ALLOWED_MODULES:
        raise ImportError(f"不允許導入模組: {name}")
    return __builtins__.__import__(name, globals, locals, fromlist, level)

def create_safe_input(input_queue):
    input_index = [0]
    def safe_input(prompt=''):
        if input_index[0] >= len(input_queue):
            raise EOFError('沒有更多輸入資料')
        value = input_queue[input_index[0]]
        input_index[0] += 1
        if prompt:
            print(prompt, end='')
        print(value)
        return value
    return safe_input

def validate_code_safety(code):
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return False, f"語法錯誤: {str(e)}"
    
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name not in ALLOWED_MODULES:
                    return False, f"不允許導入模組: {alias.name}"
        elif isinstance(node, ast.ImportFrom):
            if node.module and node.module not in ALLOWED_MODULES:
                return False, f"不允許導入模組: {node.module}"
        elif type(node) in DANGEROUS_NODES:
            return False, f"不允許使用: {type(node).__name__}"
        elif isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name):
                func_name = node.func.id
                if func_name in DANGEROUS_FUNCTIONS:
                    return False, f"不允許使用函數: {func_name}"
        elif isinstance(node, ast.Attribute):
            dangerous_attrs = {'__globals__', '__locals__', '__builtins__', '__file__', '__name__'}
            if node.attr in dangerous_attrs:
                return False, f"不允許存取屬性: {node.attr}"
    return True, None

def execute_with_timeout(code, timeout=EXECUTION_TIMEOUT, inputs=None):
    result = {'output': '', 'error': None, 'timeout': False}
    if inputs is None: inputs = []
    
    def target():
        try:
            safe_globals = {
                '__builtins__': SAFE_BUILTINS.copy(),
                '__name__': '__main__',
            }
            safe_globals['__builtins__']['__import__'] = safe_import
            safe_globals['__builtins__']['input'] = create_safe_input(inputs)
            safe_locals = {}
            
            output_buffer = io.StringIO()
            error_buffer = io.StringIO()
            
            with contextlib.redirect_stdout(output_buffer), contextlib.redirect_stderr(error_buffer):
                exec(code, safe_globals, safe_locals)
            
            output = output_buffer.getvalue()
            errors = error_buffer.getvalue()
            
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
    
    return result

# 互動式執行 session 儲存
import queue
import uuid

execution_sessions = {}

class StreamWriter:
    def __init__(self, event_queue):
        self.event_queue = event_queue
        self.buffer = ""

    def write(self, data):
        if data:
            self.event_queue.put({"type": "stdout", "data": data})

    def flush(self):
        pass

def create_interactive_input(session_id, event_queue, input_queue):
    def safe_input(prompt=''):
        if prompt:
            event_queue.put({"type": "stdout", "data": prompt})
        
        # 通知前端請求輸入
        event_queue.put({"type": "input_request", "prompt": prompt})
        
        # 等待輸入
        try:
            value = input_queue.get(timeout=300) # 5分鐘超時
            if value is None: # Session 結束或取消
                raise EOFError("Input cancelled")
            # 回顯輸入
            event_queue.put({"type": "stdout", "data": value + "\n"})
            return value
        except queue.Empty:
            raise TimeoutError("Input timeout")
            
    return safe_input

def run_interactive_code(session_id, code, event_queue, input_queue):
    result = {'output': '', 'error': None}
    
    try:
        safe_globals = {
            '__builtins__': SAFE_BUILTINS.copy(),
            '__name__': '__main__',
        }
        safe_globals['__builtins__']['__import__'] = safe_import
        safe_globals['__builtins__']['input'] = create_interactive_input(session_id, event_queue, input_queue)
        safe_locals = {}
        
        stream_writer = StreamWriter(event_queue)
        
        # 捕捉 stdout/stderr
        with contextlib.redirect_stdout(stream_writer), contextlib.redirect_stderr(stream_writer):
            exec(code, safe_globals, safe_locals)
            
        event_queue.put({"type": "done"})
        
    except Exception as e:
        event_queue.put({"type": "error", "data": str(e)})
    finally:
        # 清理
        pass

@app.route('/api/execute/interactive', methods=['POST'])
def start_interactive_execution():
    try:
        data = request.get_json()
        code = data.get('code', '')
        
        if not code:
            return jsonify({'success': False, 'error': '沒有收到程式碼'})
            
        session_id = str(uuid.uuid4())
        event_queue = queue.Queue()
        input_queue = queue.Queue()
        
        # 啟動執行緒
        thread = threading.Thread(
            target=run_interactive_code,
            args=(session_id, code, event_queue, input_queue)
        )
        thread.daemon = True
        thread.start()
        
        execution_sessions[session_id] = {
            'thread': thread,
            'event_queue': event_queue,
            'input_queue': input_queue,
            'created_at': datetime.now()
        }
        
        return jsonify({'success': True, 'session_id': session_id})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/execute/interactive/<session_id>/input', methods=['POST'])
def send_interactive_input(session_id):
    try:
        if session_id not in execution_sessions:
             return jsonify({'success': False, 'error': 'Session not found'})
             
        data = request.get_json()
        value = data.get('value', '')
        
        execution_sessions[session_id]['input_queue'].put(value)
        return jsonify({'success': True})
    except Exception as e:
         return jsonify({'success': False, 'error': str(e)})

@app.route('/api/execute/interactive/<session_id>/stream', methods=['GET'])
def stream_interactive_execution(session_id):
    if session_id not in execution_sessions:
        return jsonify({'error': 'Session not found'}), 404
        
    def generate():
        event_queue = execution_sessions[session_id]['event_queue']
        while True:
            try:
                # 等待事件
                event = event_queue.get(timeout=60)
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                
                if event['type'] in ['done', 'error']:
                    break
            except queue.Empty:
                # Keep-alive
                yield ": keep-alive\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'data': str(e)}, ensure_ascii=False)}\n\n"
                break
                
        # 清理 session
        if session_id in execution_sessions:
            del execution_sessions[session_id]

    return Response(generate(), mimetype='text/event-stream')

# 保留舊的 execute_code 用於非互動式或測試
@app.route('/api/execute', methods=['POST'])
def execute_code():
    try:
        data = request.get_json()
        code = data.get('code', '')
        inputs = data.get('inputs', [])
        
        if not code:
            return jsonify({'success': False, 'error': '沒有收到程式碼'})
        if len(code) > 50000:
            return jsonify({'success': False, 'error': '程式碼過長'})
        
        # 安全檢查
        is_safe, safety_error = validate_code_safety(code)
        if not is_safe:
             return jsonify({'success': False, 'error': f'安全檢查失敗: {safety_error}'})

        # 為了兼容舊的前端邏輯，這裡可以使用 execute_with_timeout
        # 但既然我們現在主推互動式，也可以讓這個端點內部轉為互動式並等待結果
        # 不過為了保持穩定，我們先保留原有的 execute_with_timeout 邏輯 for non-streaming calls
        
        execution_result = execute_with_timeout(code, inputs=inputs)
        
        if execution_result['timeout'] or execution_result['error']:
            return jsonify({'success': False, 'error': execution_result['error']})
        else:
            return jsonify({'success': True, 'output': execution_result['output']})
    except Exception as e:
        return jsonify({'success': False, 'error': f'伺服器錯誤: {str(e)}'})

@app.route('/api/validate', methods=['POST'])
def validate_code():
    try:
        data = request.get_json()
        code = data.get('code', '')
        if not code:
            return jsonify({'success': False, 'error': '沒有收到程式碼'})
        
        is_safe, safety_error = validate_code_safety(code)
        return jsonify({
            'success': is_safe,
            'message': '程式碼安全性檢查通過' if is_safe else f'安全檢查失敗: {safety_error}',
            'error': safety_error if not is_safe else None
        })
    except Exception as e:
        return jsonify({'success': False, 'error': f'伺服器錯誤: {str(e)}'})

# -------------------------------------------------------------------------
# 成績提交邏輯
# -------------------------------------------------------------------------

def save_score_locally(data):
    """
    備份成績到本地文件
    """
    try:
        backup_file = 'tool/scores_backup.json'
        backups = []
        if os.path.exists(backup_file):
            try:
                with open(backup_file, 'r', encoding='utf-8') as f:
                    backups = json.load(f)
            except:
                pass # 檔案損壞則覆蓋
        
        data['timestamp'] = datetime.now().isoformat()
        data['saved_locally'] = True
        backups.append(data)
        
        with open(backup_file, 'w', encoding='utf-8') as f:
            json.dump(backups, f, ensure_ascii=False, indent=2)
        print("[OK] 成績已備份到本地")
        return True
    except Exception as e:
        print(f"[ERROR] 本地備份失敗: {str(e)}")
        return False

def write_score_via_webapp(data):
    """
    透過 Google Apps Script Web App 寫入成績
    """
    try:
        if not WEBAPP_URL: return False
        response = requests.post(WEBAPP_URL, json=data, timeout=5)
        if response.status_code == 200:
            result = response.json()
            return result.get('status') == 'success'
        return False
    except Exception as e:
        print(f"[ERROR] WebApp 寫入失敗: {str(e)}")
        return False

@app.route('/api/scores/submit', methods=['POST'])
def submit_score():
    try:
        data = request.get_json()
        student_name = data.get('student_name')
        question_id = data.get('question_id')
        score = data.get('score')
        
        if not student_name or not question_id:
             return jsonify({'success': False, 'error': '資料不完整'})

        # 準備提交的資料
        payload = {
            'action': 'submit_score',
            'student_name': student_name,
            'question_id': question_id,
            'score': score,
            'code': data.get('code', ''),
            'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'detailed_scores': data.get('detailed_scores', {})
        }
        
        # 嘗試寫入 Google Sheet
        success = False
        if WEBAPP_URL:
            success = write_score_via_webapp(payload)
        
        if not success:
             # 如果 WebApp 失敗，備份到本地
             save_score_locally(payload) 
             
        return jsonify({
            'success': True, 
            'message': '成績已提交' if success else '成績已備份到本地',
            'online': success
        })

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/scores/<student_name>', methods=['GET'])
def get_student_scores(student_name):
    try:
        scores = []
        # 與 submit 類似，這裡應該有從 Sheet 讀取的邏輯
        # 但目前僅實作從本地備份讀取
        if os.path.exists('tool/scores_backup.json'):
             with open('tool/scores_backup.json', 'r', encoding='utf-8') as f:
                 all_scores = json.load(f)
                 scores = [s for s in all_scores if s.get('student_name') == student_name]
        
        return jsonify({'success': True, 'scores': scores})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/ai/analyze', methods=['POST'])
def ai_analyze_code():
    try:
        if not openai_client:
            return jsonify({'success': False, 'error': 'OpenAI API 未初始化'})
        
        data = request.get_json()
        code = data.get('code', '')
        output = data.get('output', '')
        expected_output = data.get('expected_output', '')
        question = data.get('question', '')
        custom_prompt = data.get('custom_prompt', None)
        
        if not code:
            return jsonify({'success': False, 'error': '沒有收到程式碼'})
        
        # 處理題目內容格式 (如果是 dict 則轉為字串)
        question_text = question
        if isinstance(question, dict):
             question_text = f"【{question.get('title', '')}】\n{question.get('description', '')}"
        
        # 嘗試重新載入 prompts.json (開發模式下方便調試)
        current_prompt_template = ""
        try:
             if os.path.exists('tool/prompts.json'):
                 with open('tool/prompts.json', 'r', encoding='utf-8') as f:
                     p_config = json.load(f)
                     current_prompt_template = p_config.get('analyze_prompt', {}).get('template', '')
        except:
             pass

        # 提示詞
        if custom_prompt:
            prompt_template = custom_prompt
        elif current_prompt_template:
            prompt_template = current_prompt_template
        else:
            prompt_template = prompts_config.get('analyze_prompt', {}).get('template', '')
            
        # 預設提示詞 fallback
        if not prompt_template:
            prompt_template = """你是一位專業的 Python 程式教學專家。請全面分析以下學生的程式碼：
【題目要求】
{question}
【學生程式碼】
{code}
【執行結果】
{output}
【預期輸出】
{expected_output}

請以 JSON 格式回覆，包含以下欄位：
1. feedback: 針對程式的整體評語和建議 (string)
2. overall_score: 整體評分 0-100 (int)
3. time_complexity_score: 0-10 (int)
4. space_complexity_score: 0-10 (int)
5. readability_score: 0-10 (int)
6. stability_score: 0-10 (int)

請確保是合法的 JSON 格式。"""

        prompt = prompt_template.format(
            question=question_text or '請撰寫一個 Python 程式',
            code=code,
            output=output or '(尚未執行)',
            expected_output=expected_output or '(未提供)'
        )
        
        # 強制 JSON 結構的 System Prompt
        system_content = """You are a helpful coding tutor. You must output valid JSON with the following keys:
- feedback (string)
- overall_score (int)
- time_complexity_score (int)
- space_complexity_score (int)
- readability_score (int)
- stability_score (int)
"""

        response = openai_client.chat.completions.create(
            model=get_model_name(),
            messages=[
                {"role": "system", "content": system_content},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            temperature=0.7
        )
        
        content = response.choices[0].message.content
        analysis = json.loads(content)
        
        return jsonify({'success': True, 'analysis': analysis})
        
    except Exception as e:
        return jsonify({'success': False, 'error': f'AI 分析失敗: {str(e)}'})

@app.route('/api/ai/check', methods=['POST'])
def ai_check_code():
    try:
        if not openai_client:
            return jsonify({'success': False, 'error': 'OpenAI API 未初始化'})
        
        data = request.get_json()
        code = data.get('code', '')
        output = data.get('output', '')
        expected_output = data.get('expected_output', '')
        
        prompt = f"""快速檢查這段 Python 程式：
程式碼：
{code}
實際輸出：
{output}
預期輸出：
{expected_output}

請回答：
1. match: 輸出是否一致 (bool)
2. score: 分數 0-100 (int)
3. differences: 差異列表 (list of strings)

請以 JSON 格式回覆。"""
        
        response = openai_client.chat.completions.create(
            model=get_model_name(),
            messages=[
                {"role": "system", "content": "You are a coding evaluator. Output valid JSON."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"}
        )
        
        content = response.choices[0].message.content
        result = json.loads(content)
        
        return jsonify({'success': True, 'result': result})
        
    except Exception as e:
        return jsonify({'success': False, 'error': f'AI 檢查失敗: {str(e)}'})

@app.route('/api/ai/suggest', methods=['POST'])
def ai_suggest_improvement():
    try:
        if not openai_client:
            return jsonify({'success': False, 'error': 'OpenAI API 未初始化'})
        
        data = request.get_json()
        code = data.get('code', '')
        stats = data.get('stats', {})
        output = data.get('output', '')
        score = data.get('score', None)
        
        prompt_template = prompts_config.get('suggest_prompt', {}).get('template', """
你是一位親切的程式設計老師。
學生得分：{score}
程式碼：
{code}
執行結果：
{output}
學習統計：
執行{run_count}次，錯誤{error_count}次。

請給出引導式建議 (Markdown格式)，包含肯定與後續問題(Q1, Q2...)。
""")
        
        prompt = prompt_template.format(
            score=score if score else '尚未評分',
            code=code if code else '(無)',
            output=output if output else '(無)',
            run_count=stats.get('run_count', 0),
            error_count=stats.get('error_count', 0)
        )
        
        response = openai_client.chat.completions.create(
            model=get_model_name(),
            messages=[
                {"role": "system", "content": "You are a helpful coding tutor."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7
        )
        
        text = response.choices[0].message.content
        suggestions = {
             "affirmation": "分析完成",
             "current_status": text, 
             "hints": [],
             "follow_up_questions": []
        }
        try:
             parsed = json.loads(text)
             if isinstance(parsed, dict): suggestions = parsed
        except: pass

        return jsonify({'success': True, 'suggestions': suggestions})
        
    except Exception as e:
        return jsonify({'success': False, 'error': f'AI 建議失敗: {str(e)}'})

@app.route('/api/ai/chat', methods=['POST'])
def ai_chat():
    try:
        if not openai_client:
            return jsonify({'success': False, 'error': 'OpenAI API 未初始化'})
        
        data = request.get_json()
        user_message = data.get('student_question', data.get('message', ''))
        
        # 構建上下文
        question_info = data.get('question', '')
        current_code = data.get('student_code', '')
        current_output = data.get('execution_result', '')
        
        system_content = f"""你是 Python 程式設計老師。
當前題目：{question_info}
學生程式碼：
```python
{current_code}
```
執行結果：
{current_output}

請以繁體中文回答學生問題，使用 Markdown 格式。"""
        
        def generate():
            try:
                stream = openai_client.chat.completions.create(
                    model=get_model_name(),
                    messages=[
                        {"role": "system", "content": system_content},
                        {"role": "user", "content": user_message}
                    ],
                    stream=True
                )
                
                for chunk in stream:
                    if chunk.choices[0].delta.content:
                        text = chunk.choices[0].delta.content
                        yield f"data: {json.dumps({'text': text}, ensure_ascii=False)}\n\n"
                
                yield "data: [DONE]\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'error': str(e)}, ensure_ascii=False)}\n\n"

        return Response(generate(), mimetype='text/event-stream')
        
    except Exception as e:
        return jsonify({'success': False, 'error': f'對話失敗: {str(e)}'})

# 題目 API 
@app.route('/api/questions', methods=['GET'])
def get_questions():
    global questions_cache, questions_last_fetch
    try:
        now = datetime.now()
        if questions_cache and questions_last_fetch:
            time_diff = (now - questions_last_fetch).total_seconds() / 60
            if time_diff < CACHE_EXPIRE_MINUTES:
                return jsonify({'success': True, 'questions': questions_cache, 'cached': True})
        
        questions = fetch_questions_from_sheet()
        if questions:
            questions_cache = questions
            questions_last_fetch = now
            return jsonify({'success': True, 'questions': questions, 'cached': False})
        else:
            if os.path.exists('tool/questions.json'):
                with open('tool/questions.json', 'r', encoding='utf-8') as f:
                    return jsonify({'success': True, 'questions': json.load(f), 'from_file': True})
            return jsonify({'success': False, 'error': '無法讀取題目資料'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

@app.route('/api/questions/<question_id>', methods=['GET'])
def get_question_by_id(question_id):
    return jsonify({'success': False, 'error': '請使用 /api/questions 獲取完整列表'})

@app.route('/api/questions/refresh', methods=['POST'])
def refresh_questions():
    global questions_cache, questions_last_fetch
    try:
        questions = fetch_questions_from_sheet()
        if questions:
            questions_cache = questions
            questions_last_fetch = datetime.now()
            with open('tool/questions.json', 'w', encoding='utf-8') as f:
                json.dump(questions, f, ensure_ascii=False, indent=2)
            return jsonify({'success': True, 'message': f'已重新載入 {len(questions)} 題', 'questions': questions})
        return jsonify({'success': False, 'error': '載入失敗'})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)})

# 系統 API
@app.route('/api/status', methods=['GET'])
def get_status():
    backend_status['last_check'] = datetime.now()
    return jsonify(backend_status)

@app.route('/api/restart', methods=['POST'])
def restart_backend():
    return jsonify({'success': True, 'message': '後端已重新連接'})

@app.route('/health', methods=['GET'])
@app.route('/api/health', methods=['GET'])
def health_check():
    return jsonify({'status': 'running', 'ai_provider': 'OpenAI', 'model': get_model_name()})

@app.route('/', methods=['GET'])
def index():
    return jsonify({
        'service': 'Python 診斷平台 (OpenAI 版)',
        'ai_enabled': bool(openai_client)
    })

if __name__ == '__main__':
    print('=' * 60)
    print(f'[Vibe] Python 診斷平台 - OpenAI 版 (Model: {get_model_name()})')
    print('=' * 60)
    app.run(host='0.0.0.0', port=5000, debug=False, threaded=True)
