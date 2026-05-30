# GoBirdie Desktop v2.3.0

## 🚀 Native AI Inference Engine

Python/MLX 의존성을 완전히 제거하고 Rust 네이티브 추론 엔진으로 전환했습니다.

### Major Changes

**Native LLM Inference**
- Python subprocess 제거 → `llama-cpp-2` Rust 크레이트로 in-process 추론
- GGUF Q4_K_M 양자화 모델 (1.9GB, 기존 safetensors 대비 70% 용량 감소)
- macOS Metal GPU 가속, Windows CUDA/CPU 자동 감지
- 설치 시 Python 런타임 번들링 불필요

**Rich Coaching Prompt**
- Strokes Gained 데이터를 프론트엔드에서 계산 후 백엔드로 전달
- 샷별 상세 데이터 (클럽/거리/심박수/고도/템포/SG) 포함
- Health timeline (5분 간격 심박수/스트레스/바디배터리) 포함
- 검증 라인으로 hallucination 억제

**Multi-Platform Support**
- macOS (Apple Silicon Metal) ✅
- Windows (CUDA / CPU fallback) ✅
- 단일 바이너리, 외부 런타임 의존성 없음

### Performance

| Metric | Before (MLX subprocess) | After (Native) |
|--------|------------------------|----------------|
| Cold start | ~8s (Python boot) | ~2s (model mmap) |
| Token/s (M3 Max) | ~45 t/s | ~135 t/s |
| Install size | ~800MB (w/ Python) | ~200MB (GGUF only) |
| Platform | macOS only | macOS + Windows |

### Other Changes
- `prompt_builder.rs` 전면 재작성 (JSON 구조화 프롬프트)
- `SgData` / `SgShotData` 구조체 추가
- CI 워크플로우 업데이트 (GGUF 모델 다운로드, CMake 의존성)
- `bundle_dylibs.sh` 유지 (libmtp/libusb 번들링)

### Model

`gobirdie-bllossom-Q4_K_M.gguf` — Bllossom/llama-3.2-Korean-Bllossom-3B 기반, LoRA fine-tuned, Q4_K_M 양자화.

---

**Full Changelog**: https://github.com/nicechester/GoBirdie-Desktop/compare/2.2.0...2.3.0
