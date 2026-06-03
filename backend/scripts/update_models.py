import json
import urllib.request
import urllib.error

# 读取 db.json
with open('backend/data/db.json', 'r', encoding='utf-8') as f:
    db = json.load(f)

# 从远程获取模型列表
url = 'http://localhost:8080/v1/models'
req = urllib.request.Request(url, headers={
    'Authorization': 'Bearer 13391822168',
    'Accept': 'application/json',
    'User-Agent': 'OpenClaw-Backend-Agent'
})

try:
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read().decode('utf-8'))
        remote_models = data.get('data', data)
        print(f"[Fetch] 获取到 {len(remote_models)} 个远程模型")
except urllib.error.HTTPError as e:
    print(f"[Error] HTTP {e.code}: {e.read().decode('utf-8')}")
    exit(1)

# 保留现有模型的温度/maxTokens设置
existing_models = db.get('availableModels', [])
existing_map = {m['modelId']: m for m in existing_models}

# 过滤保留非 glue provider 的模型
non_glue_models = [m for m in existing_models 
                    if m.get('provider') != 'glue' and 'localhost:8080' not in (m.get('baseUrl') or '')]

# 构建新模型列表 (glue provider)
new_models = []
for m in remote_models:
    model_id = m.get('id') or m.get('modelId') or ''
    existing = existing_map.get(model_id, {})
    
    new_models.append({
        'id': model_id,
        'name': m.get('name') or model_id,
        'modelId': model_id,
        'baseUrl': 'http://localhost:8080/v1',
        'apiKey': '13391822168',
        'provider': 'glue',
        'temperature': existing.get('temperature', 0.7),
        'maxTokens': existing.get('maxTokens', 4096),
        'description': m.get('description') or f"Via glue proxy: {model_id}"
    })

# 合并模型列表
db['availableModels'] = non_glue_models + new_models

# 保存
with open('backend/data/db.json', 'w', encoding='utf-8') as f:
    json.dump(db, f, ensure_ascii=False, indent=2)

print(f"[Success] 已更新模型列表")
print(f"  - 保留非 glue 模型: {len(non_glue_models)}")
print(f"  - 新增 glue 模型: {len(new_models)}")
print(f"  - 总计: {len(db['availableModels'])}")