/**
 * FileParserService - 文档解析服务
 * 支持解析: Word(.doc/.docx), Excel(.xlsx/.xls), PDF, TXT, 图片(base64)
 * Word 解析策略: mammoth (.docx) -> MinerU flash-extract (.doc/.docx) -> 二进制扫描 (.doc 兜底)
 */

import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import { spawn } from 'child_process';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// pdf-parse needs dynamic import (it only supports CommonJS)
async function loadPdfParse() {
  const pdfParseModule = await import('pdf-parse');
  return (pdfParseModule as any).default || pdfParseModule;
}

// MinerU CLI 路径
const MINERU_BIN = (() => {
  const npmRoot = process.env.NPM_CONFIG_PREFIX
    ? path.join(process.env.NPM_CONFIG_PREFIX, 'lib', 'node_modules')
    : path.join(os.homedir(), '.hermes', 'node', 'lib', 'node_modules');
  const candidates = [
    path.join(npmRoot, 'mineru-open-api-linux-x64', 'bin', 'mineru-open-api'),
    path.join(npmRoot, 'mineru-open-api', 'bin', 'mineru-open-api'),
    'mineru-open-api',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) || c === 'mineru-open-api') return c;
  }
  return 'mineru-open-api';
})();

export interface ParsedContent {
  type: 'text' | 'image_base64' | 'error';
  text: string;
  fileName: string;
}

/**
 * 解析文件内容
 * @param fileName 文件名
 * @param base64Data base64 编码的文件数据（不含 mime 前缀）
 * @param mimeType 文件的 MIME 类型
 */
export async function parseFile(
  fileName: string,
  base64Data: string,
  mimeType: string
): Promise<ParsedContent> {
  try {
    const buffer = Buffer.from(base64Data, 'base64');

    if (mimeType === 'text/plain' || fileName.endsWith('.txt')) {
      return parseText(buffer, fileName);
    }

    if (mimeType.includes('image/')) {
      return parseImage(base64Data, mimeType, fileName);
    }

    if (mimeType.includes('word') || mimeType.includes('document') ||
        fileName.endsWith('.docx')) {
      return await parseWord(buffer, fileName);
    }

    // .doc 是旧二进制格式，mammoth 不支持，尝试 MinerU -> 二进制扫描
    if (fileName.endsWith('.doc')) {
      return await parseOldDoc(buffer, base64Data, fileName);
    }

    if (mimeType.includes('excel') || mimeType.includes('spreadsheet') ||
        mimeType.includes('sheet') ||
        fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
      return await parseExcel(buffer, fileName);
    }

    if (mimeType.includes('pdf') || fileName.endsWith('.pdf')) {
      return await parsePdf(buffer, fileName);
    }

    // 兜底：尝试当作纯文本处理
    return parseText(buffer, fileName);
  } catch (err: any) {
    return { type: 'error', text: `解析失败: ${err.message}`, fileName };
  }
}

// ============================================
// 内部解析函数
// ============================================

function parseText(buffer: Buffer, fileName: string): ParsedContent {
  try {
    const text = buffer.toString('utf-8').trim();
    return {
      type: 'text',
      text: `【文件内容 - ${fileName}】\n${text}`,
      fileName,
    };
  } catch (err: any) {
    return { type: 'error', text: `文本文件读取失败: ${err.message}`, fileName };
  }
}

function parseImage(base64Data: string, mimeType: string, fileName: string): ParsedContent {
  return {
    type: 'image_base64',
    text: `【图片文件 - ${fileName}】\n[data:image/${mimeType.split('/')[1]};base64,${base64Data}]`,
    fileName,
  };
}

/**
 * 解析 Word 文档 (.docx)
 * 策略: mammoth 为主，失败后尝试 MinerU flash-extract
 */
async function parseWord(buffer: Buffer, fileName: string): Promise<ParsedContent> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value.trim();
    if (text && text.length > 10) {
      return {
        type: 'text',
        text: `【Word 文档内容 - ${fileName}】\n${text}`,
        fileName,
      };
    }
    // mammoth 结果为空，尝试 MinerU
  } catch {
    // mammoth 失败，尝试 MinerU
  }

  // MinerU flash-extract 兜底
  const mineruText = await callMinerU(buffer, fileName);
  if (mineruText) {
    return { type: 'text', text: mineruText, fileName };
  }

  return { type: 'error', text: 'Word 文档解析失败（mammoth 和 MinerU 均无法解析）', fileName };
}

async function parseExcel(buffer: Buffer, fileName: string): Promise<ParsedContent> {
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const lines: string[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_csv(sheet);

      // 每个 sheet 加标题
      if (workbook.SheetNames.length > 1) {
        lines.push(`=== 工作表: ${sheetName} ===`);
      }
      lines.push(data.trim());
    }

    const text = lines.join('\n');
    if (!text) {
      return { type: 'error', text: 'Excel 文件内容为空', fileName };
    }

    return {
      type: 'text',
      text: `【Excel 表格内容 - ${fileName}】\n${text}`,
      fileName,
    };
  } catch (err: any) {
    return { type: 'error', text: `Excel 文件解析失败: ${err.message}`, fileName };
  }
}

async function parsePdf(buffer: Buffer, fileName: string): Promise<ParsedContent> {
  try {
    const pdf = await loadPdfParse();
    const data = await pdf(buffer);
    const text = data.text.trim();
    if (!text) {
      return { type: 'error', text: 'PDF 内容为空', fileName };
    }
    return {
      type: 'text',
      text: `【PDF 内容 - ${fileName}】\n${text}`,
      fileName,
    };
  } catch (err: any) {
    return { type: 'error', text: `PDF 解析失败: ${err.message}`, fileName };
  }
}

// ============================================
// MinerU flash-extract 调用
// ============================================

/**
 * 调用 mineru-open-api flash-extract 解析文档
 * flash-extract: 不需要 token，免费，限制 10MB/20页，支持 .doc/.docx/.pdf/.pptx 和图片
 * @returns 提取的文本，失败返回 null
 */
async function callMinerU(buffer: Buffer, fileName: string): Promise<string | null> {
  return new Promise((resolve) => {
    const tmpDir = os.tmpdir();
    const ext = fileName.endsWith('.doc') ? '.doc' : fileName.endsWith('.pdf') ? '.pdf' : '.docx';
    const tmpFile = path.join(tmpDir, `mineru_in_${Date.now()}${ext}`);
    const tmpOut = path.join(tmpDir, `mineru_out_${Date.now()}`);

    // 写入临时文件
    fs.writeFileSync(tmpFile, buffer);

    const child = spawn(MINERU_BIN, ['flash-extract', tmpFile, '-o', tmpOut], {
      timeout: 60000,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });

    child.on('close', (code: number | null) => {
      try {
        fs.unlinkSync(tmpFile);
      } catch { /* ignore cleanup errors */ }

      if (code === 0) {
        // 读取输出目录中的 markdown 文件
        const outPath = path.join(tmpOut, 'markdown');
        let mdPath: string | null = null;
        try {
          if (fs.existsSync(outPath)) {
            const files = fs.readdirSync(outPath);
            const mdFile = files.find(f => f.endsWith('.md'));
            if (mdFile) mdPath = path.join(outPath, mdFile);
          }
        } catch { /* ignore */ }

        if (mdPath && fs.existsSync(mdPath)) {
          try {
            const text = fs.readFileSync(mdPath, 'utf-8').trim();
            // 清理临时输出目录
            try { fs.rmSync(tmpOut, { recursive: true, force: true }); } catch { /* ignore */ }
            resolve(text || null);
            return;
          } catch { /* ignore */ }
        }

        // 没有 markdown 文件但 exit code 为 0，从 stdout 取结果
        if (stdout.trim()) {
          try { fs.rmSync(tmpOut, { recursive: true, force: true }); } catch { /* ignore */ }
          resolve(stdout.trim());
          return;
        }
      }

      // MinerU 调用失败，清理
      try { fs.rmSync(tmpOut, { recursive: true, force: true }); } catch { /* ignore */ }

      if (stderr.includes('rate limit') || stderr.includes('429')) {
        resolve(null); // 限流时不报错误，下次可重试
      } else {
        resolve(null);
      }
    });

    child.on('error', (err: Error) => {
      try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      resolve(null);
    });
  });
}

// ============================================
// 解析 .doc 旧二进制格式
// ============================================

async function parseOldDoc(
  buffer: Buffer,
  base64Data: string,
  fileName: string
): Promise<ParsedContent> {
  try {
    // 策略1: MinerU flash-extract（最准确，免费无需 token）
    const mineruText = await callMinerU(buffer, fileName);
    if (mineruText && mineruText.length >= 30) {
      return {
        type: 'text',
        text: `【Word 文档内容 - ${fileName}】\n${mineruText}`,
        fileName,
      };
    }

    // 策略2: 纯 Node.js 二进制文本提取（Word 6.0/95/97/2000 格式）
    const text = extractTextFromBinaryDoc(buffer);
    if (text && text.length >= 30) {
      return {
        type: 'text',
        text: `【Word 文档内容 - ${fileName}】\n${text}`,
        fileName,
      };
    }

    return {
      type: 'error',
      text: `无法从 .doc 文件（${fileName}）提取文本内容。建议：在 Word/WPS 中将文件另存为 .docx 格式后重新上传`,
      fileName,
    };
  } catch (err: any) {
    return {
      type: 'error',
      text: `解析 .doc 文件失败: ${err.message}。建议将文件另存为 .docx 格式后上传`,
      fileName,
    };
  }
}

/**
 * 从 .doc 二进制文件提取纯文本（Word 6.0/95/97/2000 格式）
 * 原理：扫描字节流中的 UTF-16LE 和 ANSI 文本片段，过滤乱码
 */
function extractTextFromBinaryDoc(buffer: Buffer): string {
  const lines: string[] = [];
  const seen = new Set<string>();

  // 1. 提取 UTF-16LE 编码的中文/英文文本（Word 主要存储格式）
  extractUtf16Lines(buffer, lines);

  // 2. 提取 ANSI/GBK 编码的中文文本
  extractAnsiLines(buffer, lines);

  // 去重
  for (const l of lines) {
    const trimmed = l.trim();
    if (trimmed.length >= 4 && !seen.has(trimmed)) {
      seen.add(trimmed);
    }
  }

  return Array.from(seen).join('\n');
}

function extractUtf16Lines(buffer: Buffer, lines: string[]) {
  // 扫描 UTF-16LE 文本：寻找合法的 UTF-16 字符串片段
  let i = 0;
  const len = buffer.length;

  while (i < len - 4) {
    // 跳过明显的非文本区域（大量 null bytes 或控制字符）
    if (buffer[i] === 0 && buffer[i + 1] === 0) {
      i += 2;
      continue;
    }

    // 检查是否是合法的 UTF-16 字符
    let valid = true;
    let j = i;
    let charCount = 0;
    const maxChars = 500;

    while (j < len - 1 && charCount < maxChars) {
      const lo = buffer[j];
      const hi = buffer[j + 1];
      const code = lo | (hi << 8);

      if (code === 0) break; // null terminator

      // 允许: ASCII, Latin, Greek, CJK, common symbols, 中文标点
      const isValidChar =
        (code >= 0x0020 && code <= 0x007e) ||         // ASCII 可打印
        (code >= 0x00a1 && code <= 0x00ff) ||         // Latin-1
        (code >= 0x0100 && code <= 0x024f) ||         // Latin Extended
        (code >= 0x2000 && code <= 0x206f) ||         // General Punctuation
        (code >= 0x3000 && code <= 0x303f) ||         // CJK Symbols
        (code >= 0x3040 && code <= 0x30ff) ||         // Hiragana/Katakana
        (code >= 0x4e00 && code <= 0x9fff) ||         // CJK Unified Ideographs
        (code >= 0xff00 && code <= 0xffef);           // Full-width / CJK Punctuation

      if (!isValidChar) {
        valid = false;
        break;
      }

      charCount++;
      j += 2;
    }

    if (valid && charCount >= 5) {
      // 解码这个片段
      try {
        const slice = buffer.slice(i, i + charCount * 2);
        const text = slice.toString('utf16le').trim();
        if (text && /[\u4e00-\u9fff]/.test(text)) {
          lines.push(text);
        }
      } catch {
        // 忽略解码错误
      }
    }

    i += 2;
  }
}

function extractAnsiLines(buffer: Buffer, lines: string[]) {
  // 尝试用 GBK/CP936 解码中文 .doc 文件
  const candidates: string[] = [];

  // 分段扫描：每隔100字节检查是否有可读文本
  let i = 0;
  const len = buffer.length;
  const CHUNK = 200;
  const STEP = 50;

  while (i < len - CHUNK) {
    const chunk = buffer.slice(i, i + CHUNK);
    const decoded = tryDecodeChunk(chunk);
    if (decoded && decoded.length >= 6) {
      candidates.push(decoded);
    }
    i += STEP;
  }

  // 合并相邻片段
  for (const c of candidates) {
    const trimmed = c.trim();
    if (trimmed && trimmed.length >= 6) {
      // 过滤乱码：中文比例应该 > 30%
      const chineseCount = (trimmed.match(/[\u4e00-\u9fff]/g) || []).length;
      const ratio = chineseCount / trimmed.length;
      if (ratio > 0.15 || /^[a-zA-Z0-9\s,.!?;:()（）、。！？；：]+$/.test(trimmed)) {
        lines.push(trimmed);
      }
    }
  }
}

function tryDecodeChunk(buffer: Buffer): string | null {
  // 尝试 GBK -> UTF-8 -> latin-1
  const encodings = ['gbk', 'utf8', 'latin1'];
  for (const enc of encodings) {
    try {
      const text = buffer.toString(enc as BufferEncoding);
      if (text && /[\u4e00-\u9fff]/.test(text)) {
        // 确认不是乱码
        const clean = text.replace(/[^\u4e00-\u9fff\u3000-\u303f\uff00-\uffefa-zA-Z0-9\s,.!?;:()（）、。！？；：""'']/g, '');
        if (clean.length >= text.length * 0.7) {
          return clean.trim();
        }
      }
    } catch {
      // 继续尝试下一种编码
    }
  }
  return null;
}

// ============================================
// 批量解析附件
// ============================================

export interface ParsedAttachment {
  name: string;
  parsedContent: ParsedContent;
}

/**
 * 批量解析 attachments 数组
 * attachments 格式: [{ name, type, dataUrl }]
 */
export async function parseAttachments(attachments: any[]): Promise<ParsedAttachment[]> {
  if (!attachments || attachments.length === 0) return [];

  const results: ParsedAttachment[] = [];

  for (const att of attachments) {
    if (!att.dataUrl) {
      // 没有 base64 数据，跳过
      continue;
    }

    // 提取 MIME 和 base64 数据
    // dataUrl 格式: "data:image/png;base64,iVBORw0KG..."
    const parts = att.dataUrl.split(',');
    const mimeType = att.type || parts[0]?.match(/data:([^;]+)/)?.[1] || 'application/octet-stream';
    const base64Data = parts[1] || att.dataUrl;

    const parsed = await parseFile(att.name || 'unknown', base64Data, mimeType);
    results.push({ name: att.name || 'unknown', parsedContent: parsed });
  }

  return results;
}

/**
 * 将解析后的附件内容合并到用户消息文本中
 * 返回合并后的消息内容
 */
export function buildMessageWithAttachments(
  originalText: string,
  parsedAttachments: ParsedAttachment[]
): string {
  if (parsedAttachments.length === 0) return originalText;

  let content = originalText || '';

  for (const { name, parsedContent } of parsedAttachments) {
    if (parsedContent.type === 'error') {
      content += `\n\n📎 [${name}]: ${parsedContent.text}`;
    } else if (parsedContent.type === 'image_base64') {
      // 图片直接嵌入：使用 URL 或 base64
      content += `\n\n${parsedContent.text}`;
    } else {
      // 文本内容追加
      content += `\n\n${parsedContent.text}`;
    }
  }

  return content;
}