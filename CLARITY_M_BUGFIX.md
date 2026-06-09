# CLARITY M 버그 수정 기록

**날짜**: 2026-06-09  
**배포 URL**: https://soundmind-five.vercel.app  
**빌드**: TypeScript strict 통과, 에러 0개

---

## 수정된 버그 목록

### Bug 1 — RTA 좀비 루프 (freeze 원인)

**파일**: `src/components/clarity/RTA.tsx`  
**위치**: `doSetup()` → `render()` 함수 (L185)

**원인**  
`render()` 함수 내부에 `if (cancelled) return` 가드가 없었음.  
cleanup 실행 후(`cancelled = true`, `audioCtx.close()`) 이미 큐에 올라간 rAF 프레임이 실행되면:
1. 닫힌 AudioContext에서 `getFloatFrequencyData()` → `-Infinity` 반환 (예외 없음)
2. `requestAnimationFrame(render)` 재호출 → 무한 루프 지속
3. 탭 전환 반복 시 좀비 루프 누적 → CPU 100% → **브라우저 프리징**

**수정**
```typescript
// Before
const render = () => {
  analyser.getFloatFrequencyData(fftBuf)
  ...
}

// After
const render = () => {
  if (cancelled) return  // ← 좀비 루프 방지
  analyser.getFloatFrequencyData(fftBuf)
  ...
}
```

---

### Bug 2 — Goniometer 메인스레드 과부하 (프리징 주범)

**파일**: `src/components/clarity/Goniometer.tsx`  
**위치**: `processor.onaudioprocess` 콜백 전체

**원인**  
`onaudioprocess` 핸들러 안에서 직접 캔버스 드로잉을 수행함.

| 항목 | 수치 |
|------|------|
| ScriptProcessor 버퍼 크기 | 2048 샘플 |
| onaudioprocess 발화 주기 | 44100 / 2048 ≈ **22fps** |
| 루프 내 `fillRect` 호출 수 | 2048 / 4 = **512회** |
| 추가 `drawStatic()` 호출 | 22fps (7 canvas ops/call) |
| **총 canvas ops/초** | **~11,418회** |

Web Audio API의 `onaudioprocess`는 메인 스레드에서 실행되므로, 이 무거운 캔버스 작업이 React 렌더링 스케줄러를 블로킹 → **UI 프리징**.

**수정 전략**: 오디오 처리 ↔ 렌더링 완전 분리

```
onaudioprocess (22fps)          rAF tick (60fps)
─────────────────────────       ─────────────────────────
상관계수 계산 (경량)       →    샘플 ref에서 읽어 드로잉
Float32Array 저장          →    ghost overlay + dots
hasNewSamples = true             danger 테두리 (항상)
캔버스 조작: 0                   캔버스 조작: 전담
```

**핵심 코드 변경**
```typescript
// onaudioprocess: 저장만
processor.onaudioprocess = (ev) => {
  // 상관계수 계산 (경량)
  correlation = denom > 1e-10 ? Math.max(-1, Math.min(1, sumLR / denom)) : 0
  // 샘플 저장 (캔버스 조작 없음)
  samplesRef.current = { L: Float32Array.from(inputL), R: Float32Array.from(inputR) }
  hasNewSamples = true
}

// rAF tick: 드로잉 전담 (+ cancelled 가드)
const tick = () => {
  if (cancelled) return  // 좀비 루프 방지
  if (hasNewSamples && samplesRef.current) {
    hasNewSamples = false
    // ghost overlay + dots 그리기
  }
  if (correlation < -0.5) { /* danger 테두리 */ }
  rafRef.current = requestAnimationFrame(tick)
}
```

**새로 추가된 ref**
```typescript
const samplesRef = useRef<{ L: Float32Array; R: Float32Array } | null>(null)
```

**잔상(persistence) 유지**  
`hasNewSamples` dirty flag 사용 → ghost overlay는 오디오 프레임 도착 시에만 그림 → 이전과 동일한 잔상 속도(~22fps) 유지.

---

### Bug 3 — LevelMeter 피크 홀드 애니메이션 없음

**파일**: `src/components/clarity/LevelMeter.tsx`

**원인**  
`rafRef`가 선언되어 있었지만 rAF 루프가 전혀 시작되지 않았음.  
```typescript
// 이전: rafRef cleanup만 있고 루프 미시작
useEffect(() => () => cancelAnimationFrame(rafRef.current), [])
```
피크 홀드 로직이 `useEffect([tpL, tpR, ...])` 안에서만 실행 → `tpL/tpR` prop이 변경될 때만 한 번 실행.

**결과적 동작 문제**:
- 오디오 재생 중: 93ms마다 한 번씩 홀드 업데이트 (어느 정도 동작)
- 오디오 정지 후: `tpL = -Infinity` 고정 → useEffect 미발화 → 피크 홀드 지표 **영구 동결**
- 홀드 낙하 속도: 프레임 기반(0.5dB/callback) → 실제 속도 불일치

**수정 전략**: `tpL/tpR`를 ref로 관리 + 연속 rAF 루프

```typescript
// Props → ref 동기화 (렌더 중 동기 실행, stale closure 방지)
tpLRef.current = tpL
tpRRef.current = tpR

// 연속 rAF 루프 (peakHold/size 변경 시에만 재초기화)
useEffect(() => {
  const draw = () => {
    const curL = tpLRef.current  // 항상 최신값
    const curR = tpRRef.current

    // 시간 기반 낙하 (8dB/s — 프레임레이트 독립적)
    if (holdRef.current && now - holdRef.current.ts > HOLD_MS) {
      holdRef.current.db -= FALL_RATE * 16  // 16ms ≈ 1 rAF frame
    }

    // 드로잉...
    rafRef.current = requestAnimationFrame(draw)
  }
  rafRef.current = requestAnimationFrame(draw)
  return () => cancelAnimationFrame(rafRef.current)
}, [totalH, totalW, peakHold])  // tpL/tpR 제외
```

**낙하 속도 비교**

| 방식 | 낙하 속도 |
|------|----------|
| 이전 (0.5dB/callback @ 10Hz) | ~5dB/s |
| 이후 (8dB/s 시간 기반) | 8dB/s (60fps 부드러움) |

---

## 아키텍처 원칙 (이번 수정으로 확립)

1. **오디오 콜백 ≠ 렌더링**: `onaudioprocess` / `ScriptProcessor`에서 캔버스 조작 금지
2. **rAF 가드 필수**: 모든 rAF 루프 함수 첫 줄에 `if (cancelled) return`
3. **Props → ref 패턴**: rAF 클로저에서 최신 prop 읽기엔 ref 사용 (stale closure 방지)
4. **시간 기반 애니메이션**: 낙하/페이드는 `performance.now()` 기반으로 프레임레이트 독립적 구현

---

## 파일 변경 요약

| 파일 | 변경 유형 | 핵심 내용 |
|------|----------|----------|
| `src/components/clarity/RTA.tsx` | 1줄 추가 | `render()` 상단 `if (cancelled) return` |
| `src/components/clarity/Goniometer.tsx` | 전면 재작성 | onaudioprocess → 연산만, rAF → 드로잉 전담 |
| `src/components/clarity/LevelMeter.tsx` | 전면 재작성 | 연속 rAF 루프 + ref 기반 props + 시간 기반 낙하 |

---

## 관련 이전 수정 (이번 세션 이전)

| 버그 | 파일 | 수정 내용 |
|------|------|----------|
| RTA 바 바닥 고정 | `RTA.tsx` | `source → analyser → silencer → destination` 직렬 체인 |
| LUFS -∞ 고정 | `useLoudnessMeter.ts` | `ctx.resume().then(doSetup)` 패턴 적용 |
| MetricCell 비가시성 | `ClarityM.tsx` | `none: rgba(255,255,255,0.2)` → `0.55` |
| 플랫폼 선택 미작동 | `ClarityM.tsx` | `setPlatformId={() => {}}` → 실제 setter 전달 |
| Goniometer AudioContext | `Goniometer.tsx` | `doSetup` 패턴 + resume().then() |
| CorrelationMeter AudioContext | `CorrelationMeter.tsx` | `doSetup` 패턴 + resume().then() |
