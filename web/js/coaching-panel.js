import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getLang, t } from './i18n.js';

let _unlisten = null;
let _streaming = false;

// ── Modal HTML ────────────────────────────────────────────────────────────────

function _buildModal(roundId) {
    return `
    <div id="coaching-modal-backdrop"
        class="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center p-6">
        <div class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col"
             style="max-height: 85vh" data-round-id="${roundId}">

            <!-- Header -->
            <div class="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
                <div>
                    <h2 class="text-lg font-bold text-gray-800">✨ ${t('coaching.title')}</h2>
                    <p class="text-xs text-gray-400 mt-0.5">${t('coaching.desc')}</p>
                </div>
                <button id="coaching-modal-close"
                    class="text-gray-400 hover:text-gray-600 transition text-xl leading-none">✕</button>
            </div>

            <!-- Status -->
            <div id="coaching-status" class="hidden px-6 py-4 flex-shrink-0">
                <div class="flex items-center gap-2 text-xs text-gray-400">
                    <svg class="w-3 h-3 animate-spin text-purple-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                    <span>${t('coaching.analyzing')}</span>
                </div>
            </div>

            <!-- Streaming preview (gray tokens) -->
            <div id="coaching-stream-preview" class="hidden flex-1 overflow-y-auto px-6 py-4 min-h-0">
                <div id="coaching-stream-text"
                    class="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap font-mono">
                </div>
            </div>

            <!-- Streaming output -->
            <div id="coaching-output" class="hidden flex-1 overflow-y-auto px-6 py-4 min-h-0">
                <div id="coaching-text" class="text-gray-700 leading-relaxed text-sm"></div>
            </div>

            <!-- Footer -->
            <div class="flex items-center justify-between px-6 py-3 border-t flex-shrink-0">
                <button id="coaching-analyze-btn"
                    class="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg
                           hover:bg-purple-700 transition flex items-center gap-2">
                    <span id="coaching-btn-icon">✨</span>
                    <span id="coaching-btn-label">${t('coaching.analyze')}</span>
                </button>
                <button id="coaching-copy-btn"
                    class="text-xs text-gray-400 hover:text-gray-600 transition flex items-center gap-1">
                    📋 ${t('coaching.copy')}
                </button>
            </div>
        </div>
    </div>`;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function openCoachingModal(roundId) {
    // Remove any existing modal
    document.getElementById('coaching-modal-backdrop')?.remove();

    const div = document.createElement('div');
    div.innerHTML = _buildModal(roundId);
    document.body.appendChild(div.firstElementChild);

    const modal = document.getElementById('coaching-modal-backdrop');
    const lang = getLang();
    let _rawText = '';

    // Close handlers
    document.getElementById('coaching-modal-close').addEventListener('click', _closeModal);
    modal.addEventListener('click', e => { if (e.target === modal) _closeModal(); });

    // Analyze button
    document.getElementById('coaching-analyze-btn').addEventListener('click', async () => {
        if (_streaming) return;
        _rawText = '';
        await _startStreaming(roundId, lang);
    });

    // Copy button
    document.getElementById('coaching-copy-btn').addEventListener('click', () => {
        if (!_rawText) return;
        navigator.clipboard.writeText(_rawText).then(() => {
            const btn = document.getElementById('coaching-copy-btn');
            if (btn) {
                btn.textContent = '✓ Copied';
                setTimeout(() => { btn.innerHTML = `📋 ${t('coaching.copy')}`; }, 2000);
            }
        });
    });

    // Auto-start on open
    document.getElementById('coaching-analyze-btn').click();
}

function _closeModal() {
    if (_unlisten) { _unlisten(); _unlisten = null; }
    _streaming = false;
    document.getElementById('coaching-modal-backdrop')?.remove();
}

// ── Streaming ─────────────────────────────────────────────────────────────────

async function _startStreaming(roundId, lang) {
    _streaming = true;

    const btn      = document.getElementById('coaching-analyze-btn');
    const btnLabel = document.getElementById('coaching-btn-label');
    const btnIcon  = document.getElementById('coaching-btn-icon');
    const status   = document.getElementById('coaching-status');
    const output   = document.getElementById('coaching-output');
    const textEl   = document.getElementById('coaching-text');

    textEl.innerHTML = '';
    output.classList.add('hidden');
    status.classList.remove('hidden');
    btn.disabled = true;
    btnIcon.textContent = '⏳';
    btnLabel.textContent = t('coaching.analyzing');

    const preview = document.getElementById('coaching-stream-preview');
    const previewText = document.getElementById('coaching-stream-text');
    if (preview) { preview.classList.add('hidden'); }
    if (previewText) { previewText.textContent = ''; }

    // Remove skeleton timer logic — no longer needed
    if (_unlisten) { _unlisten(); _unlisten = null; }

    let _rawText = '';
    let firstContent = true;

    _unlisten = await listen('coaching_token', (event) => {
        const { text, done } = event.payload;

        if (done) {
            // Hide preview, show rendered markdown
            // Strip any leaked length instructions the model may emit
            const cleaned = _rawText
                .replace(/\(\d+[~\-]\d+字[^)]*\)\s*/g, '')
                .replace(/\(\d+[~\-]\d+\s*자[^)]*\)\s*/g, '')
                .trim();
            const preview = document.getElementById('coaching-stream-preview');
            if (preview) preview.classList.add('hidden');
            status.classList.add('hidden');
            textEl.innerHTML = _renderMarkdown(cleaned);
            output.classList.remove('hidden');
            _onStreamDone(btn, btnLabel, btnIcon, status);
            return;
        }

        // Skip leading whitespace before first real content
        if (firstContent) {
            if (!text.trim()) return;
            firstContent = false;
        }

        if (text) {
            _rawText += text;
            // Show tokens as small gray text in preview
            const preview = document.getElementById('coaching-stream-preview');
            const previewText = document.getElementById('coaching-stream-text');
            if (preview && previewText) {
                status.classList.add('hidden');
                preview.classList.remove('hidden');
                previewText.textContent = _rawText;
                preview.scrollTop = preview.scrollHeight;
            }
        }
    });

    // Store rawText reference on the modal for copy button
    document.getElementById('coaching-modal-backdrop')._rawText = () => _rawText;

    // Fix copy button to use closure
    document.getElementById('coaching-copy-btn').onclick = () => {
        if (!_rawText) return;
        navigator.clipboard.writeText(_rawText).then(() => {
            const btn = document.getElementById('coaching-copy-btn');
            if (btn) {
                btn.textContent = '✓ Copied';
                setTimeout(() => { btn.innerHTML = `📋 ${t('coaching.copy')}`; }, 2000);
            }
        });
    };

    try {
        await invoke('generate_coaching_report', { id: roundId, lang });
    } catch (e) {
        const preview = document.getElementById('coaching-stream-preview');
        if (preview) preview.classList.add('hidden');
        status.classList.add('hidden');
        textEl.textContent = `Error: ${e}`;
        output.classList.remove('hidden');
        _onStreamDone(btn, btnLabel, btnIcon, status);
    }
}

function _onStreamDone(btn, btnLabel, btnIcon, status) {
    _streaming = false;
    status.classList.add('hidden');
    btn.disabled = false;
    btnIcon.textContent = '🔄';
    btnLabel.textContent = t('coaching.reanalyze') || 'Re-analyze';
    if (_unlisten) { _unlisten(); _unlisten = null; }
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

function _renderMarkdown(md) {
    // Detect and truncate repetition loops
    const lines = md.trim().split('\n');
    const seen = new Map();
    const deduped = [];
    for (const line of lines) {
        const key = line.trim();
        if (!key) { deduped.push(line); seen.clear(); continue; }
        const count = (seen.get(key) ?? 0) + 1;
        seen.set(key, count);
        if (count > 2) break;  // stop at third repetition of same line
        deduped.push(line);
    }
    md = deduped.join('\n');

    return md
        .trim()
        .replace(/^### (.+)$/gm, '<h4 class="text-sm font-semibold text-gray-800 mt-4 mb-1">$1</h4>')
        .replace(/^## (.+)$/gm,  '<h3 class="text-base font-bold text-gray-800 mt-5 mb-2">$1</h3>')
        .replace(/^# (.+)$/gm,   '<h2 class="text-lg font-bold text-gray-900 mt-5 mb-2">$1</h2>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/^---$/gm, '<hr class="my-4 border-gray-200">')
        .replace(/^\* (.+)$/gm, '<li class="ml-4 list-disc text-gray-700 mb-1">$1</li>')
        .replace(/(<li[^>]*>[\s\S]*?<\/li>\n?)+/g, s => `<ul class="my-2">${s}</ul>`)
        .split(/\n{2,}/)
        .map(block => {
            if (block.startsWith('<h') || block.startsWith('<ul') || block.startsWith('<hr')) return block;
            return `<p class="mb-3">${block.replace(/\n/g, ' ')}</p>`;
        })
        .join('\n');
}
