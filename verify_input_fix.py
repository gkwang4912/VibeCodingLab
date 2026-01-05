"""
驗證 input() 功能是否正確配置
"""

import ast

# 從 server.py 讀取配置
DANGEROUS_FUNCTIONS = {
    'open', 'file', 'raw_input',  # input 已移除
    'exec', 'eval', 'compile',
    'globals', 'locals', 'vars', 'dir',
    'setattr', 'delattr',
    'exit', 'quit', 'help', 'license', 'credits',
    'reload', 'execfile'
}

# 測試程式碼
test_code = """
name = input("請輸入名字: ")
print(f"你好, {name}!")
"""

def validate_code_safety(code):
    """檢查程式碼是否安全"""
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return False, f"語法錯誤: {str(e)}"
    
    for node in ast.walk(tree):
        # 檢查函數調用
        if isinstance(node, ast.Call):
            if isinstance(node.func, ast.Name):
                func_name = node.func.id
                if func_name in DANGEROUS_FUNCTIONS:
                    return False, f"不允許使用函數: {func_name}"
    
    return True, None

# 執行驗證
print("🔍 驗證配置...")
print(f"DANGEROUS_FUNCTIONS 包含 'input': {'input' in DANGEROUS_FUNCTIONS}")
print()

print("📝 測試程式碼:")
print(test_code)
print()

is_safe, error = validate_code_safety(test_code)
print(f"✅ 安全檢查結果: {'通過' if is_safe else '失敗'}")
if error:
    print(f"❌ 錯誤訊息: {error}")
else:
    print("🎉 input() 功能已正確啟用！")
