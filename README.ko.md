# GoBirdie Desktop

가민, 애플 워치, 안드로이드의 골프 라운드 데이터를 분석하는 데스크탑 앱입니다. Tauri 2, 러스트, 바닐라 자바스크립트로 제작되었습니다.

🇺🇸 [English README](README.md)

## 개요

가민 골프 워치는 라운드당 두 개의 FIT 파일에 골프 활동 데이터를 저장합니다:

- **활동 파일** (`GARMIN/Activity/`) — GPS 경로, 심박수 타임라인, 샷 감지, 건강 지표
- **스코어카드 파일** (`GARMIN/SCORCRDS/`) — 홀별 스코어, 퍼팅, 페어웨이, GIR, 코스 정의

이 앱은 두 파일을 읽고 타임스탬프로 연결하여 골프 성적과 건강 데이터를 통합 표시합니다. 아이폰(로컬 WiFi), 안드로이드(로컬 WiFi + mDNS)에서도 라운드를 동기화할 수 있습니다.

## 기능

### 개요 탭
스코어, 걸은 거리, 칼로리, 평균/최대 심박수, 고도 범위, 평균 스윙 템포를 포함한 라운드 요약. 이글/버디/파/보기 색상 구분, GIR, 페어웨이 안착률이 포함된 홀별 스코어카드와 바디 배터리 소모, 스트레스, 심박수 구간 분석을 보여주는 건강 섹션이 포함됩니다.

![개요](images/ko/overview.png)

### 샷 맵 탭
모든 샷을 클럽 카테고리(드라이버, 페어웨이 우드, 아이언, 웨지, 퍼터)별 색상 선과 점으로 표시하는 인터랙티브 지도. 주요 기능:
- 개별 홀 확대를 위한 홀 선택 버튼
- 각 샷 점 옆에 클럽 약어 라벨
- 각 샷 라인에 야드 거리 표시
- 샷 팝업: 클럽, 거리, 고도 변화(↑/↓), 라이 각도(발 위/아래), 심박수 스파크라인, 스윙 템포, 그린 방향 화살표, 스트로크 게인드
- 라이 각도: Open-Topo-Data NED 10m(미국) / SRTM 30m(전 세계) — 샷 방향 기준 ±10m 수직 지점 고도 측정
- GPS 트레일 토글
- 오른쪽에 라운드 타임라인 차트 (심박수, 고도, 스트레스, 스윙 템포)

![샷 맵](images/ko/shotmap1.png)
![샷 맵 — 홀 상세](images/ko/shotmap2.png)

### 클럽 성적 탭
티샷, 어프로치 샷, 웨지, 퍼팅의 방향 분석(그린 방향 기준 좌/직진/우), 평균/최대 거리, 고도 변화, 라이 각도, 클럽 요약 테이블을 포함한 분석.

![클럽 성적](images/ko/clubperformance1.png)
![클럽 성적 — 클럽 요약](images/ko/clubperformance2.png)

### 샷 분석 탭
마크 브로디(Mark Broadie)의 책 *에브리 샷 카운트(Every Shot Counts)* 에서 제시한 방법론을 기반으로 한 스트로크 게인드(Strokes Gained) 분석. 

주요 기능:
- 요약 카드: 총 SG 및 카테고리별 (티샷, 어프로치, 숏게임, 퍼팅)
- 카테고리별 득실 수평 막대 차트
- 최고 및 최악 3개 샷 하이라이트
- 미스샷 경향, 거리 일관성 등급, 클럽별 평균 SG 테이블
- 그린까지 거리 구간별 샷 분산 히트맵
- 샷별 SG 배지가 포함된 홀별 분석 테이블

![샷 분석 — 스트로크 게인드](images/ko/shotanalysis1.png)
![샷 분석 — 분산도](images/ko/shotanalysis2.png)
![샷 분석 — 홀별](images/ko/shotanalysis3.png)

### 스윙 템포
활동 FIT 파일의 mesg #104에서 5분 이동 평균으로 캡처됩니다. 비율(백스윙:다운스윙)은 라운드 헤더, 타임라인 차트, 샷 팝업에 표시됩니다.

### AI에게 물어보기
✨ AI에게 물어보기 버튼은 파인튜닝된 3B 언어 모델([BLLOSSOM](https://huggingface.co/Bllossom/llama-3.2-Korean-Bllossom-3B))을 기기 내에서 [mlx-lm](https://github.com/ml-explore/mlx-lm)으로 실행하는 코칭 패널을 엽니다. 외부 API 호출 없이 데이터가 기기 밖으로 나가지 않습니다.

**온디바이스 AI 코칭 사전 요구사항 (Apple Silicon Mac 전용):**
```bash
# Python 3.10 이상 필요 (pyenv 권장)
brew install pyenv
pyenv install 3.11
pyenv global 3.11

# mlx-lm 설치
pip install mlx-lm
```
그 다음 모델을 다운로드하여 앱 데이터 디렉토리에 배치하세요:
```
~/Library/Application Support/go-birdie-desktop/gobirdie-bllossom-4bit/
```
설치 후 설정에서 **온디바이스 코칭**을 활성화하세요. 모델이 없으면 AI에게 물어보기 버튼은 클립보드 모드로 전환됩니다 — [Gemini](https://gemini.google.com) 또는 [ChatGPT](https://chatgpt.com)에 붙여넣을 수 있는 프롬프트를 복사합니다.

> **참고:** 온디바이스 코칭은 기본적으로 비활성화되어 있습니다. 모델과 mlx-lm 설치 후 설정에서 활성화하세요.

### AI 인사이트 (온디바이스 딥러닝)
각 라운드 상세 화면에 온디바이스 LSTM+Dense 모델이 생성한 패턴 인사이트가 표시됩니다. 외부 API 호출 없이 기기 내에서 완전히 실행되며 데이터가 외부로 전송되지 않습니다.

모델은 4개 카테고리에 걸쳐 15가지 패턴 확률을 출력합니다:

| 카테고리 | 패턴 |
|---|---|
| 티샷 | 드라이버 슬라이스, 풀훅, 템포 급가속 |
| 어프로치/아이언 | 아이언 컨택 오류, 중거리 불일치, 웨지 거리 컨트롤 |
| 숏게임 | 벙커 탈출 실패 |
| 퍼팅 | 3퍼팅 위험, 롱 퍼트 템포, 숏 퍼트 정렬 |
| 멘탈/컨디션 | 피로 조기 릴리즈, 멘탈 스노우볼, 파5 과공격, 코스 난이도 스트레스, 스코어 불안 붕괴 |

65% 이상이면 경고, 80% 이상이면 위험으로 표시됩니다. 각 인사이트에는 👍/👎 피드백 버튼이 있으며 응답은 로컬 `feedback.json`에 저장되어 모델 파인튜닝에 활용됩니다.

모델(`gobirdie_patterns.onnx`, 약 229KB)은 앱에 번들로 포함되어 `tract-onnx` 러스트 크레이트로 시작 시 로드됩니다. 추론은 일반 데스크탑에서 10ms 이내에 완료됩니다.

## 다운로드

사전 빌드된 macOS 및 Windows 바이너리는 [릴리스 페이지](https://github.com/nicechester/GoBirdie-Desktop/releases)에서 다운로드할 수 있습니다.

## 동기화 소스

첫 실행 시 기기 유형을 선택합니다:

| 기기 | 동기화 방법 |
|------|------------|
| **가민 워치** | USB 케이블 (macOS: libmtp / Windows: WPD) |
| **애플 워치** | 로컬 WiFi (mDNS) — macOS 전용 |
| **안드로이드** | 로컬 WiFi (mDNS) — GoBirdie 안드로이드 설정에서 동기화 서버 활성화 필요 |

## 빌드

### macOS
```bash
bash build.sh
```

### Windows
```bat
build.bat
```

Visual Studio 2022 C++ 워크로드 및 러스트 툴체인이 필요합니다.

## 아키텍처

```
GoBirdie-Desktop/
├── src-tauri/              러스트 백엔드
│   ├── src/
│   │   ├── main.rs         Tauri 진입점, 커맨드 등록
│   │   ├── models.rs       데이터 구조
│   │   ├── parser.rs       FIT 파일 파싱
│   │   ├── store.rs        Sled 기반 영속성
│   │   ├── mtp.rs          MTP 워치 동기화 (macOS: libmtp / Windows: WPD)
│   │   ├── apple_sync.rs   아이폰 동기화 (MultipeerConnectivity)
│   │   ├── android_sync.rs 안드로이드 동기화 (HTTP + mDNS)
│   │   └── native/
│   │       ├── garmin_mtp.c             macOS libmtp 헬퍼
│   │       └── garmin_mtp_windows.cpp   Windows WPD 헬퍼
│   ├── Cargo.toml
│   └── tauri.conf.json
│   ├── src/
│   │   ├── inference.rs    온디바이스 ONNX 추론 (tract-onnx)
├── web/                    프론트엔드 (바닐라 JS + Tailwind)
│   ├── index.html
│   └── js/
│       ├── app.js
│       ├── i18n.js
│       ├── nlg-templates.js
│       └── nlg-engine.js
├── data-prep/              오프라인 모델 학습 (개발자용)
│   ├── train.py            PyTorch LSTM+Dense 학습 스크립트
│   ├── ollama_label.py     로컬 LLM 대량 라벨링 (Ollama)
│   ├── perturb_rounds.py   합성 라운드 데이터 생성
│   ├── golden_dataset.json Gemini 검증 골든 예시
│   └── norm_constants.json 피처 정규화 상수 (러스트와 동기화)
├── build.sh                macOS 빌드 스크립트
├── build.bat               Windows 빌드 스크립트
└── vite.config.js
```

## 다국어 지원

헤더의 국기 기반 언어 토글로 모든 UI 문자열, NLG 인사이트, 날짜 형식을 영어/한국어 간 전환할 수 있습니다. 언어 설정은 `localStorage`에 저장됩니다.
