/**
 * AI Content API
 */
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function dbgLog(hypothesisId, location, message, data) {
    // #region agent log
    try {
        const line = JSON.stringify({
            sessionId: 'ff0680',
            hypothesisId,
            location,
            message,
            data,
            timestamp: Date.now(),
        });
        fs.appendFileSync(path.join(__dirname, '..', 'debug-ff0680.log'), `${line}\n`);
    } catch (_) { /* ignore */ }
    // #endregion
}

function dbgLog96(hypothesisId, location, message, data) {
    // #region agent log
    fetch('http://127.0.0.1:7429/ingest/bab48c62-adab-4008-aac1-13c63b94fd88', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '96f910' },
        body: JSON.stringify({
            sessionId: '96f910',
            hypothesisId,
            location,
            message,
            data,
            timestamp: Date.now(),
        }),
    }).catch(() => {});
    // #endregion
}

// Collect all Gemini API keys
function getGeminiKeys() {
    const keys = [];
    for (let i = 1; i <= 10; i++) {
        const k = i === 1 ? process.env.GEMINI_API_KEY : process.env[`GEMINI_API_KEY_${i}`];
        if (k && k.trim()) keys.push(k.trim());
    }
    return keys;
}

// Collect all Groq API keys
function getGroqKeys() {
    const keys = [];
    for (let i = 1; i <= 5; i++) {
        const k = i === 1 ? process.env.GROQ_API_KEY : process.env[`GROQ_API_KEY_${i}`];
        if (k && k.trim()) keys.push(k.trim());
    }
    return keys;
}

// Collect all OpenRouter API keys
function getOpenRouterKeys() {
    const keys = [];
    for (let i = 1; i <= 5; i++) {
        const k = i === 1 ? process.env.OPENROUTER_API_KEY : process.env[`OPENROUTER_API_KEY_${i}`];
        if (k && k.trim()) keys.push(k.trim());
    }
    return keys;
}

// Try one Gemini key (returns text | 'RATE_LIMIT' | null)
async function tryGemini(key, prompt, generationConfig) {
    try {
        const body = { contents: [{ parts: [{ text: prompt }] }] };
        if (generationConfig) body.generationConfig = generationConfig;
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${key}`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        );
        if (res.status === 429) return 'RATE_LIMIT';
        if (!res.ok) return null;
        const data = await res.json();
        return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
    } catch { return null; }
}

// Try one Groq key with Llama 3.1
async function tryGroq(key, prompt) {
    try {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
            body: JSON.stringify({
                model: 'llama-3.1-8b-instant',
                messages: [{ role: 'user', content: prompt }],
                temperature: 0.8,
                max_tokens: 1200
            })
        });
        if (res.status === 429) return 'RATE_LIMIT';
        if (!res.ok) return null;
        const data = await res.json();
        return data?.choices?.[0]?.message?.content?.trim() || null;
    } catch { return null; }
}

// Try one OpenRouter key with a free model
async function tryOpenRouter(key, prompt) {
    try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${key}`,
                'HTTP-Referer': process.env.APP_BASE_URL || 'http://localhost:3000',
                'X-Title': 'Vo Tri Club'
            },
            body: JSON.stringify({
                model: 'openrouter/free',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 1200
            })
        });
        if (res.status === 429) return 'RATE_LIMIT';
        if (!res.ok) return null;
        const data = await res.json();
        return data?.choices?.[0]?.message?.content?.trim() || null;
    } catch { return null; }
}

// Multi-provider rotation: Gemini → Groq → OpenRouter
async function callAIWithRotation(prompt, generationConfig = null) {
    // 1. Try all Gemini keys
    for (const key of getGeminiKeys()) {
        const result = await tryGemini(key, prompt, generationConfig);
        if (result && result !== 'RATE_LIMIT') return result;
        if (result === 'RATE_LIMIT') dbgLog('H3', 'callAIWithRotation', `Gemini key ${key.slice(0, 8)} rate-limited`, {});
    }

    // 2. Try all Groq keys
    for (const key of getGroqKeys()) {
        const result = await tryGroq(key, prompt);
        if (result && result !== 'RATE_LIMIT') return result;
        if (result === 'RATE_LIMIT') dbgLog('H3', 'callAIWithRotation', `Groq key ${key.slice(0, 8)} rate-limited`, {});
    }

    // 3. Try all OpenRouter keys
    for (const key of getOpenRouterKeys()) {
        const result = await tryOpenRouter(key, prompt);
        if (result && result !== 'RATE_LIMIT') return result;
    }

    return 'RATE_LIMIT_ERROR';
}

// Backward-compat alias
const callGeminiWithRotation = callAIWithRotation;

function buildInfoPayload(body = {}) {
    const parts = [];
    if (body.requirement) parts.push(String(body.requirement).trim());
    if (body.refUrl) parts.push(`Tham khảo: ${String(body.refUrl).trim()}`);
    if (body.platform) parts.push(`Nền tảng: ${body.platform}`);
    if (body.length) parts.push(`Độ dài: ${body.length}`);
    if (Array.isArray(body.styles) && body.styles.length) {
        parts.push(`Phong cách: ${body.styles.join(', ')}`);
    }
    if (body.info) parts.push(String(body.info).trim());
    return parts.filter(Boolean).join('\n') || 'Gợi ý chủ đề bài viết Facebook marketing';
}

async function ensureAiPostSchedulesTable(dbQuery) {
    if (!dbQuery) return;
    await dbQuery(`
        CREATE TABLE IF NOT EXISTS ai_post_schedules (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id INT NOT NULL,
            page_id VARCHAR(80) NOT NULL,
            page_name VARCHAR(255) NOT NULL,
            content TEXT NOT NULL,
            image_url TEXT DEFAULT NULL,
            schedule_time TIME NOT NULL,
            repeat_days VARCHAR(50) NOT NULL COMMENT '0=CN, 1=T2, 2=T3, 3=T4, 4=T5, 5=T6, 6=T7',
            status VARCHAR(50) NOT NULL DEFAULT 'Active',
            last_run_date DATE DEFAULT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            INDEX idx_user_id (user_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Add specific_date column if not exists
    try {
        await dbQuery(`ALTER TABLE ai_post_schedules ADD COLUMN specific_date DATE DEFAULT NULL AFTER repeat_days`);
    } catch (_) { }
}

function optimizeSearchQuery(query) {
    let clean = String(query || '').trim()
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, '');

    const words = clean.split(/\s+/).filter(Boolean);
    if (words.length <= 5) {
        return words.join(' ');
    }

    const lower = clean.toLowerCase();
    if (lower.includes('giày') || lower.includes('sneaker') || lower.includes('shoes')) return 'giày thể thao';
    if (lower.includes('mụn') || lower.includes('da') || lower.includes('spa') || lower.includes('mỹ phẩm')) return 'mỹ phẩm spa trị mụn';
    if (lower.includes('áo') || lower.includes('váy') || lower.includes('đầm') || lower.includes('quần') || lower.includes('thời trang')) return 'thời trang nam nữ';
    if (lower.includes('ăn') || lower.includes('uống') || lower.includes('món') || lower.includes('nhà hàng') || lower.includes('ẩm thực')) return 'món ăn ngon ẩm thực';
    if (lower.includes('học') || lower.includes('sách') || lower.includes('khóa học') || lower.includes('tiếng anh')) return 'giáo dục học tập';
    if (lower.includes('remote') || lower.includes('work') || lower.includes('văn phòng') || lower.includes('làm việc')) return 'làm việc văn phòng';
    if (lower.includes('sale') || lower.includes('khuyến mãi') || lower.includes('giảm giá')) return 'khuyến mãi giảm giá hot';
    if (lower.includes('ai') || lower.includes('công nghệ') || lower.includes('phần mềm') || lower.includes('điện thoại')) return 'công nghệ điện thoại thông minh';

    return words.slice(0, 4).join(' ');
}

async function extractSearchQuery(reqText) {
    if (!reqText) return '';
    const prompt = `Từ yêu cầu viết bài sau: "${reqText}". Hãy trích xuất đúng 2 đến 3 từ khóa tìm kiếm hình ảnh bằng tiếng Anh hoặc tiếng Việt mô tả trực quan sản phẩm/chủ đề chính (Ví dụ: "giày thể thao", "coffee shop interior", "skincare cream"). Chỉ trả về từ khóa tìm kiếm ngắn gọn này, không giải thích, không thêm bất kỳ từ nào khác.`;
    try {
        const keywords = await callAIWithRotation(prompt);
        if (keywords && keywords !== 'RATE_LIMIT_ERROR') {
            return keywords.replace(/["']/g, '').trim();
        }
    } catch (e) {
        console.error('[extractSearchQuery] failed:', e);
    }
    return '';
}

async function scrapeDdgImages(query, limit = 10) {
    try {
        const cleanQuery = optimizeSearchQuery(query);
        const mainUrl = `https://duckduckgo.com/?q=${encodeURIComponent(cleanQuery)}`;
        const mainRes = await fetch(mainUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
            }
        });
        if (!mainRes.ok) return [];

        const mainHtml = await mainRes.text();
        const vqdRegex = /vqd=['"]?([^&'"\s]+)['"]?/;
        const match = mainHtml.match(vqdRegex);
        if (!match) return [];

        const vqd = match[1];
        const imagesUrl = `https://duckduckgo.com/i.js?q=${encodeURIComponent(cleanQuery)}&o=json&vqd=${vqd}`;
        const imagesRes = await fetch(imagesUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
                'Accept': 'application/json',
                'Referer': 'https://duckduckgo.com/'
            }
        });
        if (!imagesRes.ok) return [];

        const data = await imagesRes.json();
        const results = data.results || [];

        return results.slice(0, limit).map(r => ({
            imageUrl: r.image,
            thumbnailUrl: r.thumbnail,
            url: r.image,
            title: r.title
        }));
    } catch (e) {
        console.error('[scrapeDdgImages] Error:', e);
        return [];
    }
}

const creativeAngles = [
    "tập trung vào chia sẻ kiến thức hữu ích, mẹo hay và giải quyết triệt để nỗi đau thầm kín của khách hàng",
    "tập trung vào xu hướng mới nhất trên mạng xã hội, các sự thật thú vị ít người biết để giật gân",
    "tập trung vào kể chuyện cảm xúc (Storytelling), hành trình vượt khó hoặc trải nghiệm thực tế chạm đến trái tim người đọc",
    "tập trung vào tạo nội dung tương tác cực cao, các ý tưởng mini-game độc lạ hoặc kịch bản video ngắn dễ viral",
    "tập trung vào so sánh sản phẩm trực diện, phân tích ưu nhược điểm và nêu bật giá trị cốt lõi vượt trội",
    "tập trung vào phong cách hài hước, châm biếm dí dỏm, meme bắt trend cực nhanh của giới trẻ",
    "tập trung vào phong cách sống đẳng cấp, sang trọng, truyền động lực thay đổi bản thân và hướng tới sự hoàn mỹ"
];

function getRandomAngle() {
    const shuffled = [...creativeAngles].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 2).join(' kết hợp với ');
}

function parseJsonArrayRobustly(text) {
    const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
    try {
        const topics = JSON.parse(cleanText);
        if (Array.isArray(topics)) return topics.filter(Boolean);
        if (topics && typeof topics === 'object') {
            if (Array.isArray(topics.topics)) return topics.topics.filter(Boolean);
            if (Array.isArray(Object.values(topics)[0])) return Object.values(topics)[0].filter(Boolean);
        }
    } catch (e) {
        console.log('[suggestTopicsWithGemini] Standard JSON parse failed (typical for non-Gemini fallbacks), using robust parser.');

        // 1. Try matching all quoted elements within brackets [...]
        const bracketMatch = cleanText.match(/\[([\s\S]*?)\]/);
        if (bracketMatch) {
            const innerContent = bracketMatch[1];
            const stringMatches = [];
            const regex = /["']([\s\S]*?)["'](?=\s*(?:,|\]|\r?\n))/g;
            let match;
            while ((match = regex.exec(innerContent)) !== null) {
                stringMatches.push(match[1].trim());
            }
            if (stringMatches.length > 0) {
                return stringMatches.filter(Boolean);
            }
        }

        // 2. Fallback: split by commas or newlines and clean quotes
        const lines = cleanText.split(/[\r\n,]+/).map(line => {
            const trimmed = line.trim();
            const isHeader = trimmed.endsWith(':');
            const cleaned = trimmed
                .replace(/^[-*•\d.\s"']+/, '') // Remove lists bullets, numbers, and leading quotes
                .replace(/["'\s]+$/, '');    // Remove trailing quotes and spaces
            return { cleaned, isHeader };
        }).filter(item => {
            if (item.cleaned.length <= 5) return false;
            if (item.isHeader) return false;

            // Check for conversational intro/outro patterns
            const conversationalRegex = /^(dưới\s+đây\s+là|sau\s+đây\s+là|đây\s+là|hy\s+vọng|chúc\s+bạn|cảm\s+ơn|tôi\s+xin|dưới\s+đây\s+tuyển|dưới\s+đây\s+gợi|sau\s+đây\s+gợi|bản\s+tin\s+này|danh\s+sách\s+chủ\s+đề|những\s+chủ\s+đề|các\s+chủ\s+đề|dưới\s+đây|tất\s+nhiên|tôi\s+có\s+thể|dưới\s+đây\s+là\s+danh\s+sách)/i;
            if (conversationalRegex.test(item.cleaned)) return false;

            return true;
        }).map(item => item.cleaned);

        if (lines.length > 0) {
            return lines;
        }

        console.warn('[suggestTopicsWithGemini] Robust extraction also failed:', e.message);
        throw e;
    }
    return null;
}

async function suggestTopicsWithGemini(info) {
    if (getGeminiKeys().length === 0 && getGroqKeys().length === 0 && getOpenRouterKeys().length === 0) return null;

    const angle = getRandomAngle();
    const prompt = `Gợi ý đúng 10 chủ đề bài viết marketing Facebook đa dạng, hấp dẫn cho: "${info}".
Lưu ý: chủ đề thực tế (shop/thương hiệu), tránh chủ đề về thuật toán FB. Góc nhìn: ${angle}.
Dùng dấu nháy đơn ' cho tiếng Anh. Trả về JSON array 10 string, không thêm gì khác.`;

    const text = await callGeminiWithRotation(prompt, {
        responseMimeType: 'application/json',
        responseSchema: { type: 'array', items: { type: 'string' } }
    });
    if (!text || text === 'RATE_LIMIT_ERROR') return text || null;
    const topics = parseJsonArrayRobustly(text);
    return Array.isArray(topics) ? topics : null;
}

// Map length code -> Vietnamese description
function mapLengthLabel(length) {
    const map = {
        'very-short': 'Rất ngắn (dưới 80 từ) — chỉ 1–2 câu đột phá, kêu gọi hành động ngay',
        'short': 'Ngắn (80–150 từ) — vào thẳng vấn đề, súc tích, hấp dẫn',
        'medium': 'Vừa phải (150–250 từ) — cân bằng giữa thông tin và cảm xúc',
        'full': 'Đầy đủ (250–350 từ) — trình bày rõ ràng, thuyết phục, có dẫn chứng',
        'detailed': 'Chi tiết (350–500 từ) — bài viết chuyên sâu, phân tích kỹ, nhiều đoạn rõ ràng',
        'long': 'Dài (250–400 từ) — chi tiết đầy đủ, kể chuyện, thuyết phục sâu',
        'very-long': 'Rất dài (trên 400 từ) — bài viết chuyên sâu, phân tích kỹ, nhiều đoạn rõ ràng'
    };
    return map[length] || map['medium'];
}

// Map style key -> Vietnamese description
function mapStyleLabel(style) {
    const map = {
        professional: 'Chuyên nghiệp — dùng ngôn ngữ lịch sự, uy tín, đáng tin cậy',
        funny: 'Hài hước — dí dỏm, vui vẻ, dễ gây cười và lan truyền',
        creative: 'Sáng tạo — dùng ý tưởng độc đáo, bất ngờ, thu hút sự chú ý',
        emotional: 'Cảm xúc — chạm đến trái tim, kể chuyện gần gũi, tạo sự đồng cảm',
        persuasive: 'Thuyết phục — dùng lý lẽ, bằng chứng và lời kêu gọi hành động mạnh',
        storytelling: 'Kể chuyện — dẫn dắt câu chuyện thu hút từ đầu đến cuối',
        formal: 'Trang trọng — ngôn ngữ nghiêm túc, phù hợp doanh nghiệp / sự kiện lớn'
    };
    return map[style] || style;
}

async function scrapeUrlContent(url) {
    if (!url) return '';
    try {
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36'
            },
            signal: AbortSignal.timeout(5000) // 5s timeout
        });
        if (!res.ok) return '';
        const html = await res.text();
        // Remove scripts & styles
        let clean = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
        clean = clean.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
        // Strip other html tags
        clean = clean.replace(/<[^>]+>/g, ' ');
        // Normalize whitespace
        clean = clean.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
        // Limit context size to 2500 chars to avoid prompt blowup
        return clean.slice(0, 2500);
    } catch (e) {
        console.warn(`[scrapeUrlContent] Failed to fetch url ${url}:`, e.message);
        return '';
    }
}

async function generatePostWithGemini(options) {
    if (getGeminiKeys().length === 0 && getGroqKeys().length === 0 && getOpenRouterKeys().length === 0) return null;

    const lengthDesc = mapLengthLabel(options.length || options.postLength || 'medium');
    const stylesArr = Array.isArray(options.styles) ? options.styles : (options.postStyles ? [options.postStyles] : ['professional']);
    const stylesDesc = stylesArr.map(mapStyleLabel).join('; ');
    const platform = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok' }[options.platform] || 'Facebook';

    let refPart = '';
    if (options.refUrl) {
        const scrapedText = await scrapeUrlContent(options.refUrl);
        if (scrapedText) {
            refPart = `\nThông tin tham khảo từ trang web (${options.refUrl}):\n"""\n${scrapedText}\n"""\nHãy chắt lọc các thông tin, đặc điểm, thông số quan trọng từ trang web trên để viết bài viết chân thực và chính xác nhất.`;
        } else {
            refPart = ` Tham khảo thông tin từ liên kết: ${options.refUrl}.`;
        }
    }

    const prompt = `Viết 1 bài đăng ${platform} bằng tiếng Việt.
Chủ đề: "${options.requirements || options.requirement || ''}"${refPart}
Độ dài: ${lengthDesc}
Phong cách: ${stylesDesc}
Yêu cầu: tiêu đề emoji cuốn hút, nội dung rõ ràng, CTA cuối bài.
Về Hashtags: Hãy thêm đúng 5 hashtag liên quan viết ghép liền chính xác chính tả tiếng Việt (ví dụ: #ThànhCông, #KinhDoanh). Tuyệt đối KHÔNG viết sai chính tả hoặc cắt cụt chữ (ví dụ KHÔNG được viết #ThànhCố).
Chỉ trả về bài viết, không thêm lời dẫn.`;

    return await callGeminiWithRotation(prompt);
}

// Fetch helper with timeout to avoid hanging API requests
async function fetchWithTimeout(resource, options = {}) {
    const { timeout = 10000, ...rest } = options;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(resource, {
            ...rest,
            signal: controller.signal
        });
        clearTimeout(id);
        return response;
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
}

// Helper to download image buffer and save locally
async function downloadAndSaveImage(imageUrl, rootDir = __dirname, meta = {}) {
    const t0 = Date.now();
    let host = '';
    try {
        host = new URL(imageUrl).hostname;
    } catch (_) { /* ignore */ }
    const isPollinations = host.includes('pollinations.ai');
    const downloadTimeout = meta.timeoutMs || (isPollinations ? 90000 : 30000);
    try {
        const response = await fetchWithTimeout(imageUrl, { timeout: downloadTimeout });
        const elapsedMs = Date.now() - t0;
        if (!response.ok) {
            // #region agent log
            dbgLog96('H3', 'content.js:downloadAndSaveImage', 'HTTP not ok', {
                host,
                status: response.status,
                elapsedMs,
                provider: meta.provider || '',
            });
            // #endregion
            return null;
        }
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Find project root uploads directory
        const uploadsDir = path.join(rootDir, '..', 'uploads');
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
        }

        const filename = `ai_img_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.jpg`;
        const filePath = path.join(uploadsDir, filename);
        fs.writeFileSync(filePath, buffer);

        // #region agent log
        dbgLog96('H3', 'content.js:downloadAndSaveImage', 'Saved image', {
            host,
            elapsedMs,
            bytes: buffer.length,
            provider: meta.provider || '',
        });
        // #endregion

        return `/uploads/${filename}`;
    } catch (e) {
        console.error('[downloadAndSaveImage] Error:', e.message);
        // #region agent log
        dbgLog96('H3', 'content.js:downloadAndSaveImage', 'Download failed', {
            host,
            elapsedMs: Date.now() - t0,
            errorName: e.name,
            errorMessage: e.message,
            aborted: e.name === 'AbortError',
            provider: meta.provider || '',
        });
        // #endregion
        return null;
    }
}

// Translate style labels to descriptive English prompts
function mapStylePrompt(style) {
    const map = {
        realistic: 'hyper-realistic photo, highly detailed, 8k resolution, professional photography',
        illustration: 'gorgeous digital illustration, vibrant colors, artistic, detailed',
        watercolor: 'beautiful watercolor painting, soft textures, artistic canvas, watercolor splash',
        cinematic: 'cinematic style, dramatic lighting, epic composition, movie scene, depth of field',
        minimalist: 'clean minimalist art, simple colors, elegant, flat design, modern aesthetic',
        cartoon: 'colorful cartoon character style, playful, cute, animated movie style',
        '3d-render': '3d render, clay style, blender render, octane render, soft ambient occlusion',
        vintage: 'vintage retro look, grainy analog film style, faded colors, nostalgic vibe'
    };
    return map[style] || '';
}

const MEME_CHART_KEYWORDS = /meme|stonk/i;
const REPORT_CHART_KEYWORDS = /chart|graph|statistic|infographic|dashboard|report|growth|metric|kpi|analytics|insights|bảng|thống kê|biểu đồ|báo cáo|chỉ số|tăng trưởng|metrics/i;
const FACEBOOK_BRAND_KEYWORDS = /facebook|\bfb\b|meta\s+business|fan\s*page/i;

function resolveImageStyleSuffix(style, promptText) {
    const text = promptText || '';
    const hasReportVisual = REPORT_CHART_KEYWORDS.test(text);
    const hasFacebook = FACEBOOK_BRAND_KEYWORDS.test(text);

    if (MEME_CHART_KEYWORDS.test(text)) {
        return 'meme infographic style, bold flat colors, clear chart layout, digital illustration, no portrait photo';
    }

    // Preserve selected artistic style if the user requested one
    const isArtisticStyle = style && style !== 'realistic';

    if (hasReportVisual && hasFacebook) {
        if (isArtisticStyle) {
            return `${mapStylePrompt(style)} depicting a Facebook Meta Business Suite analytics dashboard layout with charts, growth metrics, and Facebook branding`;
        }
        return 'Facebook Meta Business Suite analytics dashboard screenshot, growth KPI cards, engagement line charts, official Facebook blue UI branding, flat SaaS report layout, no people, no abstract 3D gold bars';
    }
    if (hasReportVisual) {
        if (isArtisticStyle) {
            return `${mapStylePrompt(style)} depicting a business analytics dashboard, growth metrics charts, and data reports`;
        }
        return 'professional business analytics dashboard, growth metrics charts, data report UI mockup, flat infographic, no portrait photo, no abstract 3D render';
    }
    
    // Realistic style is fully built within buildImagePromptText, so no style suffix is needed
    if (style === 'realistic') {
        return '';
    }
    return mapStylePrompt(style);
}

function enrichImagePromptText(userPromptTrimmed, generatedPromptText) {
    const combined = `${userPromptTrimmed} ${generatedPromptText}`.toLowerCase();
    const wantsFbReport = FACEBOOK_BRAND_KEYWORDS.test(combined) && REPORT_CHART_KEYWORDS.test(combined);
    if (!wantsFbReport) return generatedPromptText;

    const alreadyDetailed = /dashboard|insights|business suite|kpi|engagement/i.test(generatedPromptText);
    if (alreadyDetailed) return generatedPromptText;

    return `${generatedPromptText}, Facebook Business Suite analytics dashboard with growth metrics charts, KPI numbers, and Facebook logo`;
}

async function buildImagePromptText(postContent, userPrompt, style = 'realistic') {
    const userPromptTrimmed = (userPrompt || '').trim();

    if (userPromptTrimmed) {
        let translateUserOnly = '';
        if (style === 'realistic') {
            translateUserOnly = `You are an expert prompt engineer for commercial product photography AI generation (Flux/Midjourney).
Translate the following user description from Vietnamese to English and expand it into a high-end commercial product photography prompt.
Enforce these rules:
1. Structure: Start with "Commercial product photography of [Subject]" or "Editorial beauty photography of [Subject]".
2. Subject & Label: Detail the product and packaging based on the description, and append "with clean minimalist blank label, no text, no logo".
3. Background & Props: Placed on a minimalist stone podium or clean surface, with soft shadows of leaves, water droplets, or natural minimal props.
4. Camera & Lighting: Soft studio lighting, professional studio setup, eye-level shot.
5. Quality: End with "high-end advertising aesthetic, photorealistic, 8k resolution".
6. Avoid banned terms: Filter out and do not include words like "100%", "guarantee", "best", "treatment", "cure", "medicine", or text overlay. Keep the scene realistic and commercial, not sci-fi or fantasy.
User description: "${userPromptTrimmed}"
Return only the final English prompt.`;
        } else {
            translateUserOnly = `You are an expert prompt engineer for AI image generators (like Flux/Midjourney).
Translate the following user description from Vietnamese to English, and expand it into a vivid, high-quality, descriptive prompt (max 60 words).
Enforce these rules:
1. Stay strictly focused on the core subjects and themes of the user's input. Do not add unrelated themes, dashboards, Facebook ads, or metrics unless explicitly mentioned by the user.
2. Filter out and do not include any banned terms like "100%", "guarantee" (cam kết, đảm bảo), "best" (tốt nhất), "treatment" (điều trị), "cure" (chữa dứt điểm), "medicine/drug" (thuốc) from the prompt.
User description: "${userPromptTrimmed}"
Return only the final English prompt, with no introductory text or quotes.`;
        }

        try {
            let translated = await callAIWithRotation(translateUserOnly);
            if (translated && translated !== 'RATE_LIMIT_ERROR') {
                const cleaned = translated.replace(/["']/g, '').replace(/\r?\n|\r/g, ' ').trim();
                return enrichImagePromptText(userPromptTrimmed, cleaned);
            }
        } catch (_) { /* fall through */ }
        return enrichImagePromptText(userPromptTrimmed, userPromptTrimmed);
    }

    let translationPrompt = '';
    if (style === 'realistic') {
        translationPrompt = `Based on this post:
"${postContent}"

Write a vivid, high-end commercial product photography prompt (max 60 words) that visually represents the core product in the post.
Enforce these rules:
1. Structure: Start with "Commercial product photography of [Subject]" or "Editorial beauty photography of [Subject]".
2. Subject & Label: Detail the product bottle/jar, and append "with clean minimalist blank label, no text, no logo".
3. Background & Props: Placed on a minimalist stone podium or elegant surface, with soft shadows of leaves, water droplets, or natural minimal props.
4. Camera & Lighting: Soft studio lighting, professional studio setup, eye-level shot.
5. Quality: End with "high-end advertising aesthetic, photorealistic, 8k resolution".
6. Avoid banned terms: Do not include words like "100%", "guarantee", "best", "treatment", "cure", "medicine", or text overlay. Keep it realistic.
Return only the final English prompt.`;
    } else {
        translationPrompt = `Based on this post:
"${postContent}"

Write one vivid English image description (max 40 words) that visually represents the post.
Enforce these rules:
1. Keep the focus entirely on the main subjects and themes of the post. Do not add unrelated social media dashboards, KPI charts, or metrics unless they are a central theme of the post.
2. Filter out and do not include any banned terms like "100%", "guarantee" (cam kết, đảm bảo), "best" (tốt nhất), "treatment" (điều trị), "cure" (chữa dứt điểm), "medicine/drug" (thuốc) from the prompt.
Return only that one English sentence, no quotes or extra text.`;
    }

    try {
        let generated = await callAIWithRotation(translationPrompt);
        if (generated && generated !== 'RATE_LIMIT_ERROR') {
            return generated.replace(/["']/g, '').replace(/\r?\n|\r/g, ' ').trim();
        }
    } catch (_) { /* fall through */ }
    return postContent.slice(0, 100);
}

function generateKlingJWT(ak, sk) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        iss: ak,
        exp: now + 1800, // 30 mins
        iat: now
    };

    const base64UrlEncode = (obj) => {
        return Buffer.from(JSON.stringify(obj))
            .toString('base64')
            .replace(/=/g, '')
            .replace(/\+/g, '-')
            .replace(/\//g, '_');
    };

    const tokenHeader = base64UrlEncode(header);
    const tokenPayload = base64UrlEncode(payload);

    const signature = crypto
        .createHmac('sha256', sk)
        .update(`${tokenHeader}.${tokenPayload}`)
        .digest('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

    return `${tokenHeader}.${tokenPayload}.${signature}`;
}

async function generateAIImage(postContent, imageOptions, rootDir = __dirname) {
    const style = imageOptions.style || 'realistic';
    const aspect = imageOptions.aspect || '1:1';
    const userPrompt = imageOptions.prompt || '';

    // #region agent log
    dbgLog96('H2', 'content.js:generateAIImage', 'Entry', {
        userPromptLen: userPrompt.length,
        userPromptPreview: userPrompt.slice(0, 80),
        style,
        aspect,
        hasOpenAiImageEnv: !!(process.env.OPENAI_IMAGE_API_KEY || process.env.OPENAI_IMAGE_API_BASE),
        openAiImageBase: (process.env.OPENAI_IMAGE_API_BASE || '').slice(0, 60),
    });
    // #endregion

    // Map aspect to dimensions
    let width = 1024;
    let height = 1024;
    if (aspect === '16:9') {
        width = 1024;
        height = 576;
    } else if (aspect === '9:16') {
        width = 576;
        height = 1024;
    }

    const userPromptTrimmed = userPrompt.trim();
    const generatedPromptText = await buildImagePromptText(postContent, userPrompt, style);
    const styleDesc = resolveImageStyleSuffix(style, `${userPromptTrimmed} ${generatedPromptText}`);
    const finalPrompt = `${generatedPromptText}, ${styleDesc}`.trim();

    // #region agent log
    const userPromptInGenerated = userPromptTrimmed
        ? generatedPromptText.toLowerCase().includes(userPromptTrimmed.toLowerCase().slice(0, 8))
        : false;
    const combinedPrompt = `${userPromptTrimmed} ${generatedPromptText}`;
    dbgLog96('H1', 'content.js:generateAIImage', 'Prompt pipeline', {
        runId: 'post-fix-v2',
        userPrompt: userPromptTrimmed,
        usedUserPromptOnly: !!userPromptTrimmed,
        generatedPromptText: generatedPromptText.slice(0, 200),
        finalPromptPreview: finalPrompt.slice(0, 280),
        styleDescPreview: styleDesc.slice(0, 120),
        userPromptInGenerated,
        styleKind: MEME_CHART_KEYWORDS.test(combinedPrompt)
            ? 'meme'
            : (REPORT_CHART_KEYWORDS.test(combinedPrompt) && FACEBOOK_BRAND_KEYWORDS.test(combinedPrompt))
                ? 'facebook-report'
                : REPORT_CHART_KEYWORDS.test(combinedPrompt)
                    ? 'report'
                    : 'default',
    });
    // #endregion

    console.log('[AI Image Generator] Final Prompt:', finalPrompt);

    // Try Provider 0: OpenAI-Compatible Image Generator (Optional custom endpoint)
    if (process.env.OPENAI_IMAGE_API_KEY || process.env.OPENAI_IMAGE_API_BASE) {
        try {
            console.log('[AI Image Generator] Trying OpenAI-Compatible API...');
            const apiBase = (process.env.OPENAI_IMAGE_API_BASE || 'https://image.pollinations.ai').replace(/\/$/, '');
            const apiKey = process.env.OPENAI_IMAGE_API_KEY || '';
            const model = process.env.OPENAI_IMAGE_MODEL || 'flux';

            // If the base URL is image.pollinations.ai, handle it via GET request since its POST endpoint ignores JSON body
            if (apiBase.includes('image.pollinations.ai')) {
                console.log('[AI Image Generator] Intercepted image.pollinations.ai, routing via GET for prompt support...');
                const seed = Math.floor(Math.random() * 1000000);
                const pollinationUrl = `${apiBase}/prompt/${encodeURIComponent(finalPrompt)}?width=${width}&height=${height}&model=${model}&seed=${seed}&nologo=true`;
                const localPath = await downloadAndSaveImage(pollinationUrl, rootDir, { provider: 'openai-compat-get' });
                if (localPath) return localPath;
                throw new Error('Failed to download image from pollination GET redirect');
            }

            const headers = {
                'Content-Type': 'application/json'
            };
            if (apiKey && apiKey !== 'YOUR_SECRET_TOKEN') {
                headers['Authorization'] = `Bearer ${apiKey}`;
            }

            const res = await fetchWithTimeout(`${apiBase}/v1/images/generations`, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model,
                    prompt: finalPrompt,
                    n: 1,
                    size: `${width}x${height}`
                }),
                timeout: 30000
            });

            if (res.ok) {
                const contentType = res.headers.get('content-type') || '';
                if (contentType.startsWith('image/')) {
                    const arrayBuffer = await res.arrayBuffer();
                    const buffer = Buffer.from(arrayBuffer);
                    const uploadsDir = path.join(rootDir, '..', 'uploads');
                    if (!fs.existsSync(uploadsDir)) {
                        fs.mkdirSync(uploadsDir, { recursive: true });
                    }
                    const filename = `ai_img_${Date.now()}_openai_direct.jpg`;
                    fs.writeFileSync(path.join(uploadsDir, filename), buffer);
                    return `/uploads/${filename}`;
                } else {
                    const data = await res.json();
                    const imgUrl = data?.data?.[0]?.url;
                    const b64Json = data?.data?.[0]?.b64_json;

                    if (imgUrl) {
                        const localPath = await downloadAndSaveImage(imgUrl, rootDir);
                        if (localPath) return localPath;
                    } else if (b64Json) {
                        const buffer = Buffer.from(b64Json, 'base64');
                        const uploadsDir = path.join(rootDir, '..', 'uploads');
                        if (!fs.existsSync(uploadsDir)) {
                            fs.mkdirSync(uploadsDir, { recursive: true });
                        }
                        const filename = `ai_img_${Date.now()}_openai.jpg`;
                        fs.writeFileSync(path.join(uploadsDir, filename), buffer);
                        return `/uploads/${filename}`;
                    }
                }
            } else {
                console.warn('[AI Image Generator] OpenAI-Compatible failed status:', res.status);
            }
        } catch (e) {
            console.warn('[AI Image Generator] OpenAI-Compatible failed:', e.message);
        }
    }



    // Try Provider 3: Official Kling AI API (if credentials set)
    if (process.env.KLING_AK && process.env.KLING_SK) {
        try {
            console.log('[AI Image Generator] Trying official Kling AI API...');
            const jwtToken = generateKlingJWT(process.env.KLING_AK, process.env.KLING_SK);

            const submitRes = await fetchWithTimeout('https://api-singapore.klingai.com/v1/images/generations', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${jwtToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model_name: 'kling-v1',
                    prompt: finalPrompt,
                    aspect_ratio: aspect === '16:9' ? '16:9' : aspect === '9:16' ? '9:16' : '1:1'
                }),
                timeout: 15000
            });

            if (submitRes.ok) {
                const submitData = await submitRes.json();
                if (submitData && submitData.data && submitData.data.task_id) {
                    const taskId = submitData.data.task_id;
                    console.log(`[AI Image Generator] Kling task submitted, ID: ${taskId}. Polling...`);

                    let imageUrl = null;
                    for (let i = 0; i < 10; i++) {
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        const pollRes = await fetchWithTimeout(`https://api-singapore.klingai.com/v1/images/generations/${taskId}`, {
                            method: 'GET',
                            headers: {
                                'Authorization': `Bearer ${jwtToken}`,
                                'Content-Type': 'application/json'
                            },
                            timeout: 5000
                        });
                        if (pollRes.ok) {
                            const pollData = await pollRes.json();
                            const taskStatus = pollData?.data?.task_status;
                            console.log(`[AI Image Generator] Kling task status: ${taskStatus}`);
                            if (taskStatus === 'succeed') {
                                imageUrl = pollData?.data?.task_result?.images?.[0]?.url;
                                break;
                            } else if (taskStatus === 'failed') {
                                break;
                            }
                        }
                    }

                    if (imageUrl) {
                        const localPath = await downloadAndSaveImage(imageUrl, rootDir);
                        if (localPath) return localPath;
                    }
                }
            } else {
                console.warn('[AI Image Generator] Kling submit failed status:', submitRes.status);
            }
        } catch (e) {
            console.warn('[AI Image Generator] Kling AI failed:', e.message);
        }
    }

    // Try Provider 4: Hugging Face (FLUX Schnell)
    if (process.env.HUGGINGFACE_API_KEY) {
        try {
            console.log('[AI Image Generator] Trying HuggingFace...');
            const res = await fetchWithTimeout('https://api-inference.huggingface.co/models/black-forest-labs/FLUX.1-schnell', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ inputs: finalPrompt }),
                timeout: 10000
            });
            if (res.ok) {
                const arrayBuffer = await res.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);

                const uploadsDir = path.join(rootDir, '..', 'uploads');
                if (!fs.existsSync(uploadsDir)) {
                    fs.mkdirSync(uploadsDir, { recursive: true });
                }
                const filename = `ai_img_${Date.now()}_hf.jpg`;
                fs.writeFileSync(path.join(uploadsDir, filename), buffer);
                return `/uploads/${filename}`;
            } else {
                console.warn('[AI Image Generator] HuggingFace failed status:', res.status);
            }
        } catch (e) {
            console.warn('[AI Image Generator] HuggingFace failed:', e.message);
        }
    }

    // Try Provider 5: Together AI (FLUX)
    if (process.env.TOGETHER_API_KEY) {
        try {
            console.log('[AI Image Generator] Trying Together AI...');
            const res = await fetchWithTimeout('https://api.together.xyz/v1/images/generations', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.TOGETHER_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'black-forest-labs/FLUX.1-schnell',
                    prompt: finalPrompt,
                    width,
                    height,
                    steps: 4,
                    n: 1,
                    response_format: 'base64'
                }),
                timeout: 12000
            });
            if (res.ok) {
                const data = await res.json();
                if (data && data.data && data.data[0] && data.data[0].b64_json) {
                    const buffer = Buffer.from(data.data[0].b64_json, 'base64');
                    const uploadsDir = path.join(rootDir, '..', 'uploads');
                    if (!fs.existsSync(uploadsDir)) {
                        fs.mkdirSync(uploadsDir, { recursive: true });
                    }
                    const filename = `ai_img_${Date.now()}_together.jpg`;
                    fs.writeFileSync(path.join(uploadsDir, filename), buffer);
                    return `/uploads/${filename}`;
                }
            } else {
                console.warn('[AI Image Generator] Together AI failed status:', res.status);
            }
        } catch (e) {
            console.warn('[AI Image Generator] Together AI failed:', e.message);
        }
    }

    // Try Provider 6: DeepInfra
    if (process.env.DEEPINFRA_API_KEY) {
        try {
            console.log('[AI Image Generator] Trying DeepInfra...');
            const res = await fetchWithTimeout('https://api.deepinfra.com/v1/inference/black-forest-labs/FLUX-1-schnell', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.DEEPINFRA_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    prompt: finalPrompt,
                    width,
                    height,
                    num_inference_steps: 4
                }),
                timeout: 12000
            });
            if (res.ok) {
                const data = await res.json();
                if (data && data.images && data.images[0]) {
                    const base64Data = data.images[0].replace(/^data:image\/\w+;base64,/, '');
                    const buffer = Buffer.from(base64Data, 'base64');
                    const uploadsDir = path.join(rootDir, '..', 'uploads');
                    if (!fs.existsSync(uploadsDir)) {
                        fs.mkdirSync(uploadsDir, { recursive: true });
                    }
                    const filename = `ai_img_${Date.now()}_deepinfra.jpg`;
                    fs.writeFileSync(path.join(uploadsDir, filename), buffer);
                    return `/uploads/${filename}`;
                }
            } else {
                console.warn('[AI Image Generator] DeepInfra failed status:', res.status);
            }
        } catch (e) {
            console.warn('[AI Image Generator] DeepInfra failed:', e.message);
        }
    }

    // Try Provider 7: Pollinations.ai (FREE Fallback) - model=turbo (FAST)
    try {
        console.log('[AI Image Generator] Trying Pollinations.ai (model=turbo FAST)...');
        const seed = Math.floor(Math.random() * 1000000);
        const pollinationUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}?model=turbo&width=${width}&height=${height}&seed=${seed}&nologo=true`;

        const localPath = await downloadAndSaveImage(pollinationUrl, rootDir, { provider: 'pollinations-turbo' });
        if (localPath) {
            return localPath;
        }
    } catch (e) {
        console.warn('[AI Image Generator] Pollinations model=turbo fallback failed:', e.message);
    }

    // Try Provider 8: Pollinations.ai (FREE Fallback) - default model
    try {
        console.log('[AI Image Generator] Trying Pollinations.ai (default)...');
        const seed = Math.floor(Math.random() * 1000000);
        const pollinationUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}?width=${width}&height=${height}&seed=${seed}&nologo=true`;

        const localPath = await downloadAndSaveImage(pollinationUrl, rootDir, { provider: 'pollinations-default' });
        if (localPath) {
            return localPath;
        }
    } catch (e) {
        console.warn('[AI Image Generator] Pollinations default fallback failed:', e.message);
    }

    // Try Provider 9: Pollinations.ai with model=sana
    try {
        console.log('[AI Image Generator] Trying Pollinations.ai with model=sana...');
        const seed = Math.floor(Math.random() * 1000000);
        const pollinationUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}?model=sana&width=${width}&height=${height}&seed=${seed}&nologo=true`;

        const localPath = await downloadAndSaveImage(pollinationUrl, rootDir, { provider: 'pollinations-sana' });
        if (localPath) {
            return localPath;
        }
    } catch (e) {
        console.warn('[AI Image Generator] Pollinations.ai with model=sana failed:', e.message);
    }

    // Try Provider 10: DuckDuckGo search fallback
    try {
        const queryTerm = userPromptTrimmed || generatedPromptText || postContent.slice(0, 100);
        // #region agent log
        dbgLog96('H4', 'content.js:generateAIImage', 'DDG fallback query', {
            queryTerm: queryTerm.slice(0, 200),
            userPrompt,
            userPromptUsedInDdg: queryTerm.includes(userPrompt) || queryTerm.toLowerCase().includes(userPrompt.toLowerCase().slice(0, 8)),
        });
        // #endregion
        console.log('[AI Image Generator] Falling back to DuckDuckGo image search for:', queryTerm);
        const ddgResults = await scrapeDdgImages(queryTerm, 5);
        if (ddgResults && ddgResults.length > 0) {
            for (const item of ddgResults) {
                const targetUrl = item.imageUrl || item.url;
                if (targetUrl) {
                    const localPath = await downloadAndSaveImage(targetUrl, rootDir);
                    if (localPath) {
                        return localPath;
                    }
                }
            }
            // Return raw URL of the first image if download failed
            const rawFallback = ddgResults[0].imageUrl || ddgResults[0].url;
            if (rawFallback) {
                console.warn('[AI Image Generator] DDG fallback download failed, returning raw URL');
                return rawFallback;
            }
        }
    } catch (e) {
        console.error('[AI Image Generator] DuckDuckGo search fallback failed:', e.message);
    }

    return null;
}

function createContentRouter({ dbQuery, requireAuth }) {
    const router = express.Router();
    let dbInitialized = false;

    async function ensureDb() {
        if (!dbInitialized && dbQuery) {
            await ensureAiPostSchedulesTable(dbQuery);
            dbInitialized = true;
        }
    }

    router.post('/suggest-topics', requireAuth, async (req, res) => {
        try {
            const info = buildInfoPayload(req.body);
            dbgLog('H2', 'routes/content.js:suggest-topics', 'Direct Gemini suggest topics', {
                infoLen: info.length
            });

            if (!process.env.GEMINI_API_KEY) {
                return res.status(400).json({
                    success: false,
                    message: 'Thiếu GEMINI_API_KEY trong .env trên server.',
                    error: 'MISSING_GEMINI_API_KEY'
                });
            }

            const topics = await suggestTopicsWithGemini(info);
            if (topics === 'RATE_LIMIT_ERROR') {
                return res.status(429).json({
                    success: false,
                    message: 'Khóa API Gemini của bạn đạt giới hạn cuộc gọi (Rate limit 15 RPM). Vui lòng đợi 30 giây và thử lại!'
                });
            }
            if (!topics || topics.length === 0) {
                return res.status(500).json({
                    success: false,
                    message: 'Không thể gợi ý chủ đề từ Gemini AI.'
                });
            }

            return res.json({ success: true, topics });
        } catch (err) {
            dbgLog('H2', 'routes/content.js:suggest-topics', 'Exception', { err: err.message });
            console.error('[CONTENT suggest-topics]', err);
            return res.status(500).json({ success: false, message: 'Lỗi kết nối dịch vụ gợi ý chủ đề.' });
        }
    });

    // POST /api/content/generate-post - Tạo bài viết AI (Gemini trực tiếp)
    router.post('/generate-post', requireAuth, async (req, res) => {
        try {
            const options = req.body.options || {
                requirements: req.body.requirements || req.body.requirement || '',
                refUrl: req.body.refUrl || '',
                length: req.body.length || 'medium',
                styles: req.body.styles || [],
                platform: req.body.platform || 'facebook',
                imagePrompt: req.body.imagePrompt || req.body.imgPrompt || ''
            };

            dbgLog('H2', 'routes/content.js:generate-post', 'Direct Gemini generate post', {
                requirementsLen: (options.requirements || '').length,
                length: options.length || options.postLength || 'medium',
                styles: options.styles || options.postStyles || [],
                platform: options.platform || 'facebook',
            });

            if (!process.env.GEMINI_API_KEY) {
                return res.status(400).json({
                    success: false,
                    message: 'Thiếu GEMINI_API_KEY trong .env trên server.',
                    error: 'MISSING_GEMINI_API_KEY'
                });
            }

            const content = await generatePostWithGemini(options);
            if (content === 'RATE_LIMIT_ERROR') {
                return res.status(429).json({
                    success: false,
                    message: 'Khóa API Gemini của bạn đạt giới hạn cuộc gọi (Rate limit 15 RPM). Vui lòng đợi 30 giây và thử lại!'
                });
            }
            if (!content) {
                return res.status(500).json({
                    success: false,
                    message: 'Không thể tạo bài viết từ Gemini AI.'
                });
            }

            // If imageSource is 'ai' and we have imageOptions, call generateAIImage:
            let image = "";
            const imageSource = req.body.imageSource || (req.body.options && req.body.options.imageSource);
            const imageOptions = req.body.imageOptions || (req.body.options && req.body.options.imageOptions);

            // #region agent log
            dbgLog96('H2', 'content.js:generate-post', 'Image options from request', {
                imageSource,
                imageOptionsPrompt: (imageOptions && imageOptions.prompt) ? String(imageOptions.prompt).slice(0, 80) : '',
                hasImageOptions: !!imageOptions,
            });
            // #endregion

            if (imageSource === 'ai' && imageOptions) {
                try {
                    image = await generateAIImage(content, imageOptions);
                } catch (e) {
                    console.error('[GENERATE POST] Image generation error:', e);
                }
            }

            return res.json({
                success: true,
                data: {
                    content,
                    image
                }
            });
        } catch (err) {
            dbgLog('H2', 'routes/content.js:generate-post', 'Exception', { err: err.message });
            console.error('[CONTENT generate-post]', err);
            return res.status(500).json({ success: false, message: 'Lỗi kết nối dịch vụ tạo bài viết AI.' });
        }
    });

    // POST /api/content/get-images-hybrid - Lấy ảnh từ DuckDuckGo Image Search
    router.post('/get-images-hybrid', requireAuth, async (req, res) => {
        try {
            const query = req.body.query || '';
            const limit = Math.min(20, Math.max(1, parseInt(req.body.limit, 10) || 10));

            let searchQuery = query;
            // Optimize long conversational prompts using AI
            const lowerQuery = query.toLowerCase();
            if (query.length > 25 || lowerQuery.includes('viết') || lowerQuery.includes('bài') || lowerQuery.includes('giúp') || lowerQuery.includes('cho') || lowerQuery.includes('về')) {
                const aiKeywords = await extractSearchQuery(query);
                if (aiKeywords) {
                    searchQuery = aiKeywords;
                }
            }

            dbgLog('H2', 'routes/content.js:get-images-hybrid', 'DDG image search', {
                originalQuery: query,
                searchQuery,
                limit
            });

            const ddgImages = await scrapeDdgImages(searchQuery, limit);
            if (!ddgImages || ddgImages.length === 0) {
                return res.status(500).json({
                    success: false,
                    message: 'Không thể lấy hình ảnh từ dịch vụ tìm kiếm.'
                });
            }

            return res.json({ success: true, data: { images: ddgImages } });
        } catch (err) {
            dbgLog('H2', 'routes/content.js:get-images-hybrid', 'Exception', { err: err.message });
            console.error('[CONTENT get-images-hybrid]', err);
            return res.status(500).json({ success: false, message: 'Lỗi kết nối dịch vụ tìm kiếm ảnh.' });
        }
    });

    // POST /api/content/schedule - Lưu lịch đăng bài định kỳ
    router.post('/schedule', requireAuth, async (req, res) => {
        try {
            await ensureDb();
            const { pageId, pageName, content, imageUrl, scheduleTime, repeatDays, specificDate } = req.body;

            if (!pageId || !pageName || !content || !scheduleTime || (!repeatDays && !specificDate)) {
                return res.status(400).json({ success: false, message: 'Thiếu thông tin bắt buộc để đặt lịch đăng bài.' });
            }

            const daysStr = repeatDays ? (Array.isArray(repeatDays) ? repeatDays.join(',') : String(repeatDays)) : '';

            await dbQuery(
                `INSERT INTO ai_post_schedules (user_id, page_id, page_name, content, image_url, schedule_time, repeat_days, specific_date)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [req.user.id, pageId, pageName, content, imageUrl || null, scheduleTime, daysStr, specificDate || null]
            );

            return res.json({ success: true, message: 'Lên lịch đăng bài lặp lại định kỳ thành công!' });
        } catch (err) {
            console.error('[CONTENT schedule]', err);
            return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lên lịch đăng bài.' });
        }
    });

    // GET /api/content/schedules - Danh sách lịch đăng bài
    router.get('/schedules', requireAuth, async (req, res) => {
        try {
            await ensureDb();
            const schedules = await dbQuery(
                `SELECT id, page_id, page_name, content, image_url, 
                        TIME_FORMAT(schedule_time, '%H:%i') AS schedule_time, 
                        repeat_days, specific_date, status, created_at
                 FROM ai_post_schedules 
                 WHERE user_id = ? 
                 ORDER BY created_at DESC`,
                [req.user.id]
            );
            return res.json({ success: true, schedules });
        } catch (err) {
            console.error('[CONTENT schedules]', err);
            return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi lấy danh sách lịch đăng.' });
        }
    });

    // DELETE /api/content/schedule/:id - Hủy lịch đăng bài
    router.delete('/schedule/:id', requireAuth, async (req, res) => {
        try {
            await ensureDb();
            const result = await dbQuery(
                `DELETE FROM ai_post_schedules WHERE id = ? AND user_id = ?`,
                [req.params.id, req.user.id]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, message: 'Không tìm thấy lịch đăng bài hoặc không có quyền xóa.' });
            }

            return res.json({ success: true, message: 'Đã hủy lịch đăng bài thành công!' });
        } catch (err) {
            console.error('[CONTENT schedule delete]', err);
            return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi hủy lịch đăng bài.' });
        }
    });

    // POST /api/content/optimize-ads-safe - Tối ưu hóa bài viết bằng AI an toàn chạy Ads
    router.post('/optimize-ads-safe', async (req, res) => {
        try {
            const { content } = req.body;
            if (!content || !content.trim()) {
                return res.status(400).json({ success: false, message: 'Nội dung bài viết không được trống.' });
            }

            const prompt = `You are a social media copywriter specializing in Facebook Ads policies.
Please optimize and rewrite the following social media post to make it fully compliant with advertising policies.
Specifically, scan and rewrite any prohibited or high-risk claims, promises, or terms:
- Prohibited: "cam kết", "100%", "đảm bảo", "chuyên gia", "authority", "điều trị", "chữa dứt điểm", "cải thiện sức khỏe", "thuốc".
- Recommendations: Rephrase them using softer, compliant Vietnamese words such as "hỗ trợ", "ưu tiên", "tập trung", "hạn chế", "phù hợp", "dưỡng chất", "sản phẩm".
- Keep the original meaning, structure, length, tone, emojis, and styling (e.g. bold, sections, bullet points) as close to the original as possible.
- The output must be natural, attractive, professional, and readable Vietnamese.
- Do NOT output any introductory text, notes, explanation, or quotes. Just output the optimized post directly.

Post to optimize:
"""
${content.trim()}
"""`;

            const optimizedText = await callAIWithRotation(prompt);
            if (!optimizedText || optimizedText === 'RATE_LIMIT_ERROR') {
                return res.status(500).json({
                    success: false,
                    message: 'Không thể tối ưu hóa nội dung bằng AI lúc này. Vui lòng thử lại sau.'
                });
            }

            const cleanedResult = optimizedText.trim().replace(/^["']|["']$/g, '');
            return res.json({ success: true, optimizedContent: cleanedResult });
        } catch (err) {
            console.error('[CONTENT optimize-ads-safe]', err);
            return res.status(500).json({ success: false, message: 'Lỗi máy chủ khi tối ưu bài viết.' });
        }
    });

    return router;
}

module.exports = { createContentRouter, generateAIImage };
