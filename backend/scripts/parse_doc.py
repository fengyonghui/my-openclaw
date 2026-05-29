#!/usr/bin/env python3
"""
parse_doc.py - 解析 .doc 二进制格式 Word 文档（用于 .docx 无法解析时）
支持: antiword, catdoc, python-docx, olefile

用法: python parse_doc.py <base64_data> <output_json>
"""
import sys
import base64
import json
import os

def find_tool():
    """查找可用的 .doc 解析工具"""
    tools = []
    # Linux/WSL
    for cmd in ['antiword', 'catdoc']:
        if os.system(f'{cmd} -h >/dev/null 2>&1') == 0:
            tools.append(cmd)
    # Windows: 尝试 antiword (通常不在 PATH)
    if os.name == 'nt':
        for path in [r'C:\antiword\antiword.exe', r'C:\Program Files\antiword\antiword.exe']:
            if os.path.exists(path):
                tools.append(('antiword', path))
    return tools

def parse_with_antiword(buffer, tool_path=None):
    """用 antiword 解析 .doc"""
    import subprocess, tempfile, os, shlex
    
    with tempfile.NamedTemporaryFile(suffix='.doc', delete=False, mode='wb') as f:
        f.write(buffer)
        tmp_path = f.name
    try:
        cmd = tool_path or 'antiword'
        result = subprocess.run(
            [cmd, '-w', '0', tmp_path],
            capture_output=True, text=True, timeout=30
        )
        return result.stdout.strip()
    except Exception as e:
        return None
    finally:
        os.unlink(tmp_path)

def parse_with_catdoc(buffer):
    """用 catdoc 解析 .doc"""
    import subprocess, tempfile, os
    
    with tempfile.NamedTemporaryFile(suffix='.doc', delete=False, mode='wb') as f:
        f.write(buffer)
        tmp_path = f.name
    try:
        result = subprocess.run(
            ['catdoc', '-d', 'utf-8', tmp_path],
            capture_output=True, text=True, timeout=30
        )
        return result.stdout.strip()
    except Exception:
        return None
    finally:
        os.unlink(tmp_path)

def parse_with_python_docx(buffer):
    """用 python-docx 解析 .doc（部分格式支持）"""
    try:
        import subprocess, tempfile, os
        
        with tempfile.NamedTemporaryFile(suffix='.docx', delete=False, mode='wb') as f:
            f.write(buffer)
            tmp_path = f.name
        try:
            from docx import Document
            doc = Document(tmp_path)
            return '\n'.join(p.text for p in doc.paragraphs if p.text.strip())
        finally:
            os.unlink(tmp_path)
    except ImportError:
        return None
    except Exception:
        return None

def parse_binary_doc(buffer):
    """直接从 .doc 二进制提取文本（Word 6.0/95 格式）"""
    try:
        content = buffer.decode('latin-1', errors='ignore')
        lines = []
        # 逐行提取可打印文本
        for line in content.split('\r\n'):
            s = line.strip()
            if not s or len(s) < 5:
                continue
            # 过滤乱码：可打印字符+中文+标点需超过70%
            good = sum(1 for c in s if c.isprintable() or ord(c) > 127)
            if good / max(len(s), 1) > 0.65:
                # 去掉不可见控制字符
                clean = ''.join(c for c in s if c.isprintable() or ord(c) > 127)
                lines.append(clean)
        # 去掉重复行和太短的行
        seen, result = set(), []
        for l in lines:
            if l not in seen and len(l) >= 6:
                seen.add(l)
                result.append(l)
        return '\n'.join(result)
    except Exception:
        return None

def main():
    if len(sys.argv) < 3:
        print(json.dumps({'error': '用法: parse_doc.py <base64> <output_json>'}))
        sys.exit(1)
    
    base64_data = sys.argv[1]
    output_path = sys.argv[2]
    file_name = sys.argv[3] if len(sys.argv) > 3 else 'unknown'
    
    try:
        buffer = base64.b64decode(base64_data)
    except Exception as e:
        result = {'error': f'Base64解码失败: {e}', 'type': 'error', 'text': '', 'fileName': file_name}
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False)
        return
    
    result = {'fileName': file_name}
    
    # 策略1: python-docx（最通用）
    text = parse_with_python_docx(buffer)
    if text and len(text) > 50:
        result.update({'type': 'text', 'text': f'【Word 文档内容 - {file_name}】\n{text}', 'success': True})
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False)
        return
    
    # 策略2: antiword
    text = parse_with_antiword(buffer)
    if text and len(text) > 50:
        result.update({'type': 'text', 'text': f'【Word 文档内容 - {file_name}】\n{text}', 'success': True})
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False)
        return
    
    # 策略3: catdoc
    text = parse_with_catdoc(buffer)
    if text and len(text) > 50:
        result.update({'type': 'text', 'text': f'【Word 文档内容 - {file_name}】\n{text}', 'success': True})
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False)
        return
    
    # 策略4: 二进制提取（兜底）
    text = parse_binary_doc(buffer)
    if text and len(text) > 30:
        result.update({'type': 'text', 'text': f'【Word 文档内容 - {file_name}】\n{text}', 'success': True})
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False)
        return
    
    result.update({
        'type': 'error',
        'text': f'无法解析 .doc 文件（{file_name}）。建议：1) 安装 python-docx (pip install python-docx); 2) 在 Word/WPS 中另存为 .docx 格式后重新上传',
        'success': False
    })
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, ensure_ascii=False)

if __name__ == '__main__':
    main()