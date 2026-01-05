"""
Google Sheets 題目讀取器
從 Google Sheets 讀取程式題目資料
"""

import requests
import json
import re

# Google Sheets URL
SHEET_URL = "https://docs.google.com/spreadsheets/d/1XMDWl1EBJ2SGY6xviSBC7zk3jt4EV10jPGdAiJtflsA/export?format=csv&gid=0"

def fetch_questions_from_sheet():
    """
    從 Google Sheets 讀取題目資料
    返回題目列表
    """
    try:
        # 下載 CSV 資料
        response = requests.get(SHEET_URL, timeout=10)
        response.encoding = 'utf-8'
        
        if response.status_code != 200:
            print(f"❌ 無法訪問 Google Sheets: HTTP {response.status_code}")
            return None
        
        # 解析 CSV
        lines = response.text.strip().split('\n')
        
        if len(lines) < 2:
            print("❌ Sheet 資料格式錯誤")
            return None
        
        # 解析標題行
        headers = parse_csv_line(lines[0])
        print(f"📋 欄位: {headers}")
        
        # 解析資料行
        questions = []
        for i, line in enumerate(lines[1:], start=2):
            if not line.strip():
                continue
            
            try:
                values = parse_csv_line(line)
                
                # 確保欄位數量一致
                while len(values) < len(headers):
                    values.append('')
                
                # 獲取原始資料（新的欄位結構）
                task_info = values[0] if len(values) > 0 else ''
                description = values[1] if len(values) > 1 else ''
                example_image = values[2] if len(values) > 2 else ''  # 示例圖片在第3欄
                # 舊的 test_data 欄位已不存在
                test_data = ''
                
                # 解析任務編號和主題
                task_match = re.match(r'Task\s*(\d+)[：:]\s*(.+)', task_info)
                if task_match:
                    task_id = task_match.group(1)
                    task_title = task_match.group(2).strip()
                else:
                    task_id = str(i - 1)
                    task_title = task_info
                
                # 清理描述（移除括號內的提示）
                clean_description = re.sub(r'（[^）]*）', '', description).strip()
                if not clean_description:
                    clean_description = description
                
                # 提取括號內的提示作為 hints（保留供後續使用）
                hints_from_desc = re.findall(r'（([^）]+)）', description)
                
                # 處理示例圖片 URL
                example_image_url = example_image.strip() if example_image else ''
                
                # 解析測資為預期輸出範例
                test_cases = []
                if test_data:
                    # 移除「\r」等特殊字符
                    test_data = test_data.replace('\r', '').strip()
                    # 分割測試案例
                    cases = re.split(r'[、,，]', test_data)
                    for case in cases:
                        case = case.strip()
                        if case and '→' in case:
                            input_part, output_part = case.split('→', 1)
                            test_cases.append({
                                'input': input_part.strip(),
                                'output': output_part.strip()
                            })
                
                # 根據題目類型給予難度
                difficulty = '入門'
                if 'Task 3' in task_info or 'Task 4' in task_info:
                    difficulty = '中級'
                elif 'Task 1' in task_info:
                    difficulty = '入門'
                elif 'Task 2' in task_info:
                    difficulty = '初級'
                
                # 構建題目物件
                question = {
                    'id': task_id,
                    'title': task_title,
                    'description': clean_description,
                    'difficulty': difficulty,
                    'test_cases': test_cases,
                    'hints': hints_from_desc,  # 保留 hints（從描述提取）
                    'example_image': example_image_url,  # 新增：示例圖片
                    'learning_goals': extract_learning_goals(task_title),
                    'original_data': {
                        'task_info': task_info,
                        'description': description,
                        'test_data': test_data,
                        'example_image': example_image
                    }
                }
                
                questions.append(question)
                
            except Exception as e:
                print(f"⚠️  第 {i} 行解析失敗: {str(e)}")
                continue
        
        print(f"✅ 成功讀取 {len(questions)} 道題目")
        return questions
        
    except requests.exceptions.RequestException as e:
        print(f"❌ 網路請求失敗: {str(e)}")
        return None
    except Exception as e:
        print(f"❌ 讀取失敗: {str(e)}")
        return None

def parse_csv_line(line):
    """
    解析 CSV 行（處理雙引號和逗號）
    """
    values = []
    current = ""
    in_quotes = False
    
    i = 0
    while i < len(line):
        char = line[i]
        
        if char == '"':
            if in_quotes and i + 1 < len(line) and line[i + 1] == '"':
                # 雙引號轉義
                current += '"'
                i += 2
                continue
            else:
                # 切換引號狀態
                in_quotes = not in_quotes
                i += 1
                continue
        
        if char == ',' and not in_quotes:
            # 欄位分隔
            values.append(current)
            current = ""
            i += 1
            continue
        
        current += char
        i += 1
    
    # 添加最後一個欄位
    values.append(current)
    
    return values

def extract_learning_goals(title):
    """
    根據題目標題提取學習目標
    """
    goals = []
    
    # 根據關鍵字判斷學習目標
    keywords_map = {
        '字串': ['理解字串操作', '掌握字串方法'],
        '數字': ['理解數值運算', '掌握算術運算子'],
        '輸入': ['掌握 input() 函數', '理解資料型別轉換'],
        '總和': ['理解迴圈累加', '掌握 for 迴圈'],
        '最大值': ['掌握條件判斷', '理解比較運算子'],
        '比較': ['理解邏輯運算', '掌握 if-elif-else'],
        '反轉': ['理解字串切片', '掌握字串索引'],
        '回文': ['理解對稱判斷邏輯', '掌握字串比較'],
        '數列': ['理解串列操作', '掌握 list 資料結構'],
        '平均': ['掌握統計計算', '理解 sum() 和 len()']
    }
    
    for keyword, goal_list in keywords_map.items():
        if keyword in title:
            goals.extend(goal_list)
    
    # 如果沒有匹配到，給一個通用目標
    if not goals:
        goals = ['理解基礎 Python 語法', '掌握程式邏輯思維']
    
    return goals[:3]  # 最多返回3個目標


def save_questions_to_file(questions, filename='questions.json'):
    """
    將題目儲存到 JSON 檔案
    """
    try:
        with open(filename, 'w', encoding='utf-8') as f:
            json.dump(questions, f, ensure_ascii=False, indent=2)
        print(f"✅ 題目已儲存到 {filename}")
        return True
    except Exception as e:
        print(f"❌ 儲存失敗: {str(e)}")
        return False

def print_questions_summary(questions):
    """
    列印題目摘要
    """
    if not questions:
        print("❌ 沒有題目資料")
        return
    
    print("\n" + "=" * 60)
    print("📚 題目列表")
    print("=" * 60)
    
    for i, q in enumerate(questions, start=1):
        print(f"\n【題目 {i}】")
        print(f"  ID: {q.get('id', 'N/A')}")
        print(f"  標題: {q.get('title', 'N/A')}")
        print(f"  難度: {q.get('difficulty', 'N/A')}")
        print(f"  描述: {q.get('description', 'N/A')[:60]}...")
        
        if 'test_cases' in q and q['test_cases']:
            print(f"  測試案例: {len(q['test_cases'])} 組")
            for j, tc in enumerate(q['test_cases'][:2], start=1):
                print(f"    {j}. 輸入: {tc['input']} → 輸出: {tc['output']}")
        
        if 'learning_goals' in q and q['learning_goals']:
            print(f"  學習目標: {', '.join(q['learning_goals'][:2])}")
        
        if 'hints' in q and q['hints']:
            print(f"  提示: {len(q['hints'])} 項")
        
        if 'example_image' in q and q['example_image']:
            print(f"  示例圖片: {q['example_image'][:50]}..." if len(q['example_image']) > 50 else f"  示例圖片: {q['example_image']}")
    
    print("\n" + "=" * 60)

if __name__ == "__main__":
    print("🚀 開始從 Google Sheets 讀取題目...")
    print(f"📍 URL: {SHEET_URL}")
    print()
    
    # 讀取題目
    questions = fetch_questions_from_sheet()
    
    if questions:
        # 列印摘要
        print_questions_summary(questions)
        
        # 儲存到檔案
        save_questions_to_file(questions)
        
        print("\n✅ 完成！題目資料已準備好")
    else:
        print("\n❌ 讀取失敗，請檢查網路連接和 Sheet 權限")
