# SoundMind AI Dashboard — SPEC.md

> 공연장·교회 음향 엔지니어를 위한 현장 맞춤형 음향 만능 AI 대시보드 시스템  
> 운영 비용 $0 / 할루시네이션 전면 차단 / Amoled Black 다크 UI

---

## Commands

```bash
# React UI 개발 서버 실행
npm run dev

# React UI 프로덕션 빌드
npm run build

# Python RAG 에이전트 실행 (로컬 테스트용)
python engine/agent.py

# Python 의존성 설치
pip install -r engine/requirements.txt

# Supabase 로컬 설정 초기화
node supabase/init.js

# 전체 스택 동시 실행 (개발용)
npm run dev:all
```

---

## Project Structure

```
soundmind-ai/
├── SPEC.md                          ← 이 파일
├── package.json
├── vite.config.ts
├── tsconfig.json
├── .env.local                       ← API 키 (git 제외)
│
├── src/                             ← React + TypeScript UI
│   ├── main.tsx
│   ├── App.tsx
│   ├── index.css                    ← Amoled Black 전역 스타일
│   │
│   ├── components/
│   │   ├── chat/
│   │   │   ├── ChatPanel.tsx        ← Dual-Track RAG 채팅 UI
│   │   │   ├── TrackOfficial.tsx    ← 공식 문서 결과 패널
│   │   │   └── TrackCommunity.tsx   ← 커뮤니티 팁 결과 패널
│   │   │
│   │   ├── utils/
│   │   │   ├── HowlingDetector.tsx  ← Web Audio API FFT 하울링 감지
│   │   │   ├── EQMaskingGuide.tsx   ← 등청감곡선 기반 EQ 마스킹 해소
│   │   │   └── CompressorGuide.tsx  ← 트랜지언트 기반 컴프레서 추천
│   │   │
│   │   ├── console/
│   │   │   └── LiveConsole.tsx      ← Self-Healing 실시간 터미널 뷰
│   │   │
│   │   └── ui/
│   │       ├── FaderSlider.tsx      ← 아날로그 믹서 감성 Fader UI
│   │       ├── KnobControl.tsx      ← 아날로그 노브 UI
│   │       └── TouchTarget.tsx      ← 한 손 조작용 대형 터치 타깃
│   │
│   ├── hooks/
│   │   ├── useSupabaseRealtime.ts   ← WebSocket 생명주기 관리
│   │   ├── useGroqChat.ts           ← Groq API 스트리밍 훅
│   │   └── useAudioAnalyzer.ts      ← Web Audio API 래퍼
│   │
│   ├── lib/
│   │   ├── supabaseClient.ts        ← Supabase 클라이언트 초기화
│   │   ├── errorHandler.ts          ← 전역 에러 캡처 + Supabase 전송
│   │   └── hallucinationGuard.ts    ← AI 응답 소스 검증 로직
│   │
│   └── data/
│       ├── eqMaskingMap.json        ← 악기별 주파수 마스킹 룩업 테이블
│       ├── compressorPresets.json   ← 악기별 컴프레서 파라미터 DB
│       └── fletcherMunson.json      ← 등청감곡선 데이터
│
├── engine/                          ← Python RAG 에이전트
│   ├── agent.py                     ← 메인 진입점 (FastAPI or Flask)
│   ├── requirements.txt
│   │
│   ├── rag/
│   │   ├── query_parser.py          ← 장비명·증상 파싱
│   │   ├── track_official.py        ← Track A: 공식 문서 검색·파싱
│   │   ├── track_community.py       ← Track B: 커뮤니티 검색·파싱
│   │   ├── source_classifier.py     ← URL 도메인 기반 소스 분류
│   │   └── hallucination_guard.py   ← 소스 없는 문장 차단 필터
│   │
│   ├── crawlers/
│   │   ├── base_crawler.py          ← 공통 스크래핑 유틸리티
│   │   ├── duckduckgo_search.py     ← DuckDuckGo 비공식 API 래퍼
│   │   ├── tavily_search.py         ← Tavily API 래퍼 (무료 1,000 req/월)
│   │   └── page_parser.py           ← HTML → 정제 텍스트 변환
│   │
│   └── groq_client.py               ← Groq API (Llama 3.3 / Qwen) 래퍼
│
├── supabase/
│   ├── init.js                      ← 테이블 생성 초기화 스크립트
│   ├── schema.sql                   ← error_logs 테이블 DDL
│   └── realtime.config.js           ← Realtime 채널 설정
│
└── api/                             ← Vercel Edge Functions
    ├── rag.ts                       ← RAG 오케스트레이터 엔드포인트
    └── health.ts                    ← 헬스체크
```

---

## Harness Bridge Schema

### `error_logs` 테이블 (Supabase PostgreSQL)

```sql
-- supabase/schema.sql

CREATE TABLE error_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 에러 분류
  error_type      TEXT NOT NULL,
  -- 예: "TypeError", "NetworkError", "AudioContextError", "GroqRateLimit"

  -- 원시 에러 데이터
  raw_log         JSONB NOT NULL,
  -- {
  --   "message": "Cannot read properties of null",
  --   "stack": "...",
  --   "component": "HowlingDetector",
  --   "line": 47,
  --   "user_agent": "...",
  --   "timestamp": "2026-06-06T12:00:00Z"
  -- }

  -- Self-Healing 상태 머신
  status          TEXT NOT NULL DEFAULT 'detecting'
                  CHECK (status IN (
                    'detecting',   -- 에러 감지됨
                    'parsing',     -- 원인 분석 중
                    'patching',    -- 패치 생성 중
                    'deploying',   -- Vercel 재배포 중
                    'success',     -- 복구 완료
                    'failed'       -- 자동 복구 불가 (수동 개입 필요)
                  )),

  -- 생성된 패치 코드 diff
  patch_code_diff TEXT,
  -- unified diff 형식:
  -- "--- a/src/hooks/useAudioAnalyzer.ts\n+++ b/..."

  -- Self-Healing 진행 로그 (실시간 스트리밍용)
  healing_log     TEXT[],
  -- ["에러 감지: TypeError L.47", "원인: audioCtx null 체크 누락", ...]

  -- 세션 메타
  session_id      TEXT,
  resolved_at     TIMESTAMPTZ
);

-- Realtime 활성화 (Self-Healing Console 스트리밍)
ALTER TABLE error_logs REPLICA IDENTITY FULL;

-- 인덱스
CREATE INDEX idx_error_logs_status ON error_logs(status);
CREATE INDEX idx_error_logs_created ON error_logs(created_at DESC);

-- 30일 후 자동 삭제 (무료 500MB 쿼터 방어)
SELECT cron.schedule(
  'delete-old-error-logs',
  '0 3 * * *',
  $$DELETE FROM error_logs WHERE created_at < now() - interval '30 days'$$
);
```

### Realtime 채널 구조

```
채널명: error-healing:{session_id}
이벤트:
  INSERT  → Live Console에 새 에러 행 표시
  UPDATE  → status/healing_log 변경 시 터미널 스트리밍
  status = 'success' → 채널 자동 unsubscribe (비용 방어)
```

---

## Code Style & Boundaries

### TypeScript (Frontend)

```typescript
// tsconfig.json 핵심 설정
{
  "compilerOptions": {
    "strict": true,           // 모든 엄격 모드 활성화
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUncheckedIndexedAccess": true
  }
}
```

**필수 규칙:**
- `any` 타입 사용 금지 → `unknown` 후 타입 가드 사용
- AI 응답은 반드시 `hallucinationGuard.ts`를 통과한 후 렌더링
- Web Audio API 사용 시 `AudioContext` null 체크 필수 (iOS Safari 대응)
- Supabase WebSocket: 컴포넌트 unmount 시 `unsubscribe()` 의무 호출

### Python (Engine)

```python
# PEP8 준수, Black 포매터 사용
# 린터: flake8 --max-line-length=100

# 모든 크롤러 함수는 타입 힌트 필수
def search_official_docs(query: str, device_name: str) -> list[dict[str, str]]:
    ...
```

**필수 규칙:**
- 모든 외부 HTTP 요청은 `try/except` + 3회 재시도 로직 적용
- Groq API 응답은 소스 URL 없으면 해당 문장 삭제 후 반환
- DuckDuckGo 요청 간 1.5초 딜레이 (차단 방어)
- Tavily 요청 카운터 Supabase에 기록 → 월 1,000회 접근 시 DuckDuckGo 전용 전환

### 할루시네이션 차단 (Hallucination Guard) — 핵심 로직

```
AI 응답 생성 원칙:
1. 모든 사실 주장은 검색 결과 소스 URL을 인라인 인용 필수
2. 소스가 없는 문장은 [UNVERIFIED] 태그 → 프론트엔드에서 렌더링 차단
3. 프롬프트 마지막 줄에 항상 추가:
   "소스 문서에서 확인할 수 없는 내용은 절대 생성하지 마세요.
    확인 불가 시 '해당 정보는 검색된 문서에서 찾을 수 없습니다.'라고만 출력."
4. 응답 파싱 후 URL 패턴 검증: 인용 URL이 실제 검색 결과 목록에 있는지 대조
```

### API 비용 절대 방어 규칙

| 규칙 | 내용 |
|-----|-----|
| Groq 무료 한도 | 분당 30 req 초과 시 큐잉 대기, 절대 유료 플랜 전환 없음 |
| Supabase 무료 쿼터 | DB 500MB / 동접 200 / 월 5GB 대역폭 — 초과 시 기능 제한 모드 |
| Tavily 무료 한도 | 월 1,000 req — 950회 도달 시 경고 배너, 1,000회 시 DuckDuckGo 전용 |
| Vercel 무료 한도 | 함수 실행 100만회 / 월 100GB — 미터링 대시보드 주 1회 확인 |
| 유료 API 키 | `.env.local`에 저장, 절대 코드에 하드코딩 금지, git 커밋 금지 |

---

## UI/UX Rules — Amoled Black 다크 테마

### 색상 시스템

```css
/* src/index.css */
:root {
  --bg-primary:    #000000;  /* Amoled 순수 블랙 (OLED 픽셀 OFF) */
  --bg-surface:    #0A0A0A;  /* 카드·패널 배경 */
  --bg-elevated:   #141414;  /* 모달·드롭다운 */
  --border:        #1F1F1F;  /* 구분선 */

  --accent-green:  #00FF88;  /* 신호 정상 / 활성 */
  --accent-amber:  #FFB300;  /* 경고 / 주의 */
  --accent-red:    #FF3B30;  /* 에러 / 클리핑 */
  --accent-blue:   #0A84FF;  /* 정보 / 링크 */

  --text-primary:  #F5F5F5;
  --text-secondary:#8A8A8A;
  --text-muted:    #3A3A3A;

  /* 믹서 감성 그라디언트 */
  --fader-track:   linear-gradient(to bottom, #1A1A1A, #0A0A0A);
  --fader-thumb:   linear-gradient(135deg, #2A2A2A, #1A1A1A);
  --vu-meter-low:  #00FF88;
  --vu-meter-mid:  #FFB300;
  --vu-meter-peak: #FF3B30;
}
```

### 터치 타깃 규격 (한 손 조작)

```
최소 터치 타깃 크기: 56px × 56px (WCAG 기준 44px 초과)
권장 터치 타깃 크기: 72px × 72px (장갑 착용 환경 대응)
타깃 간 최소 간격:   12px
주요 액션 버튼:      88px × 88px (화면 하단 엄지 존)

Fader (채널 페이더):
  폭:       48px
  높이:     280px (세로 방향)
  Thumb:    48px × 24px (가로로 넓은 그립감)
  이동 범위: -∞ dB ~ +10 dB (MIDI 감도 1dB/8px)

Knob (EQ 노브):
  지름:     64px
  회전 범위: 270° (7시 → 5시)
  표시:     각도 텍스트 + 수치 오버레이
```

### 가독성 규칙 (어두운 조정실)

```
폰트 크기 최솟값:  16px (본문), 20px (레이블), 28px (수치)
폰트 계열:        'JetBrains Mono' (수치), 'Inter' (UI 텍스트)
대비비:           최소 7:1 (WCAG AAA — 어두운 환경 기준 상향)
애니메이션:       300ms ease-in-out (빠른 피드백, 어지러움 방지)
VU 미터 갱신:     60fps (requestAnimationFrame)
야간 모드 전용:   빨강 배제 (야간 시각 보호 옵션 토글 제공)
```

---

## 스크래핑 방어 전략 (Anti-Bot Bypass)

> 대상: Yamaha Pro Audio, Shure, QSC, Allen & Heath 공식 문서 사이트  
> + ProSoundWeb, Gearspace, Reddit r/audio 포럼

### 1계층: 검색 API 우선 (크롤링 최소화)

```
전략: 직접 크롤링 전에 DuckDuckGo/Tavily 검색 결과의
      snippet 텍스트만으로 답변 가능한지 먼저 판단.
      snippet으로 충분하면 페이지 진입 생략 → 차단 리스크 0

구현:
  1. 검색 결과 snippet 길이 > 500자 → 페이지 크롤링 스킵
  2. 제조사 공식 PDF 링크 감지 시 → PyMuPDF로 직접 파싱
     (HTML 크롤링보다 차단 가능성 낮음)
```

### 2계층: HTTP 헤더 위장

```python
# engine/crawlers/base_crawler.py

HEADERS_POOL = [
    {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                      "AppleWebKit/537.36 (KHTML, like Gecko) "
                      "Chrome/125.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Ch-Ua": '"Google Chrome";v="125"',
    },
    # ... Chrome/Firefox/Safari 풀 로테이션 (요청마다 랜덤 선택)
]

# 요청 간 딜레이: 균일 딜레이 대신 랜덤 딜레이 (봇 패턴 회피)
import random, time
def polite_delay():
    time.sleep(random.uniform(1.2, 3.8))
```

### 3계층: 도메인별 맞춤 파싱 전략

| 도메인 | 차단 수준 | 전략 |
|-------|---------|-----|
| `pro.yamaha.com` | 낮음 | requests + BeautifulSoup 직접 파싱 |
| `pubs.shure.com` | 낮음 | PDF 링크 감지 → PyMuPDF 파싱 |
| `qsc.com` | 중간 | `Referer: https://www.google.com` 헤더 추가 |
| `prosoundweb.com` | 낮음 | 직접 파싱 (기술 포럼, 봇 친화적) |
| `gearspace.com` | 중간 | 쿠키 세션 유지 + Referer 위장 |
| `reddit.com` | 낮음 | Reddit JSON API `{url}.json` 사용 (공식) |
| `gearslutz.com` | 중간 | 세션 쿠키 + 딜레이 3~5초 |

### 4계층: Cloudflare 우회 (고강도 차단 사이트)

```python
# Cloudflare JS 챌린지 우회: cloudscraper 라이브러리
# pip install cloudscraper

import cloudscraper

scraper = cloudscraper.create_scraper(
    browser={'browser': 'chrome', 'platform': 'darwin', 'mobile': False}
)
response = scraper.get(url, timeout=15)
```

**주의:** cloudscraper는 Cloudflare 버전 업데이트 시 우회 실패 가능.  
실패 시 → Tavily API fallback (Tavily는 자체 크롤링 인프라 보유)

### 5계층: 콘텐츠 파싱 정제 파이프라인

```python
# engine/crawlers/page_parser.py

from bs4 import BeautifulSoup
import re

def extract_clean_text(html: str, url: str) -> str:
    soup = BeautifulSoup(html, "lxml")

    # 노이즈 제거
    for tag in soup(["script", "style", "nav", "footer",
                     "header", "aside", "advertisement"]):
        tag.decompose()

    # 포럼별 맞춤 셀렉터
    if "prosoundweb.com" in url:
        content = soup.select(".post-content, .thread-body")
    elif "gearspace.com" in url:
        content = soup.select(".post_message")
    elif "reddit.com" in url:
        content = soup.select(".md")  # 마크다운 렌더링 영역
    else:
        # 일반 페이지: 가장 긴 텍스트 블록 추출
        content = soup.select("main, article, .content, #content")

    text = " ".join(c.get_text(separator="\n", strip=True) for c in content)

    # 연속 공백·줄바꿈 정리
    text = re.sub(r'\n{3,}', '\n\n', text)
    text = re.sub(r' {2,}', ' ', text)

    # 최대 4,000자로 잘라서 Groq 토큰 절약
    return text[:4000]
```

### 6계층: 실패 시 Graceful Fallback 체인

```
1차: DuckDuckGo snippet만으로 응답 시도
  ↓ 실패 (snippet 부족)
2차: 페이지 직접 크롤링 (requests + cloudscraper)
  ↓ 실패 (차단)
3차: Tavily API (자체 크롤링 인프라)
  ↓ 실패 (Tavily 한도 소진)
4차: "해당 장비의 공식 문서를 직접 확인하세요: {검색 URL}" 출력
     → 할루시네이션 없이 투명하게 한계 고지
```

---

## Environment Variables

```bash
# .env.local (절대 git에 포함하지 말 것)

# Groq API (무료)
GROQ_API_KEY=gsk_...

# Supabase (무료 티어)
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...

# Tavily (무료 1,000 req/월)
TAVILY_API_KEY=tvly-...

# 환경 구분
VITE_ENV=development
```

---

## Definition of Done

- [ ] `npm run build` 에러 없이 완료 (TypeScript strict 통과)
- [ ] Groq API 응답에 소스 없는 문장 0개 (hallucinationGuard 검증)
- [ ] 모든 터치 타깃 최소 56px × 56px 충족
- [ ] Supabase WebSocket: 에러 해결 후 자동 unsubscribe 확인
- [ ] Tavily 요청 카운터 Supabase에 정상 기록 확인
- [ ] Amoled Black (#000000) 배경 전 페이지 적용 확인
- [ ] 스마트폰 마이크 권한 요청 → 하울링 FFT 분석 동작 확인
