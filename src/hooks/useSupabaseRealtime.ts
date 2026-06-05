import { useEffect, useRef, useState, useCallback } from 'react'
import { supabase, isSupabaseConfigured, type ErrorLogRow, type HealingStatus } from '../lib/supabaseClient'

export type { ErrorLogRow, HealingStatus }

export interface RealtimeState {
  rows:        ErrorLogRow[]
  connected:   boolean
  lastStatus:  HealingStatus | null
}

export function useSupabaseRealtime(sessionId: string) {
  const [state, setState]   = useState<RealtimeState>({ rows: [], connected: false, lastStatus: null })
  const channelRef          = useRef<ReturnType<NonNullable<typeof supabase>['channel']> | null>(null)
  const autoDisconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const disconnect = useCallback(() => {
    if (autoDisconnectTimer.current) { clearTimeout(autoDisconnectTimer.current); autoDisconnectTimer.current = null }
    if (channelRef.current && supabase) {
      supabase.removeChannel(channelRef.current)
      channelRef.current = null
    }
    setState(prev => ({ ...prev, connected: false }))
  }, [])

  // 행 업서트 헬퍼
  const upsertRow = useCallback((row: ErrorLogRow) => {
    setState(prev => {
      const idx = prev.rows.findIndex(r => r.id === row.id)
      const rows = idx >= 0
        ? prev.rows.map((r, i) => i === idx ? row : r)
        : [...prev.rows, row]
      const lastStatus = row.status
      // 완료 상태 → 2초 후 자동 연결 해제 (비용 방어)
      if (row.status === 'success' || row.status === 'failed') {
        autoDisconnectTimer.current = setTimeout(disconnect, 2000)
      }
      return { ...prev, rows, lastStatus }
    })
  }, [disconnect])

  // 최신 행 fetch
  const fetchLatest = useCallback(async () => {
    if (!supabase) return
    const { data } = await supabase
      .from('error_logs')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(20)
    if (data) setState(prev => ({
      ...prev,
      rows: data as ErrorLogRow[],
      lastStatus: (data[0] as ErrorLogRow | undefined)?.status ?? null,
    }))
  }, [sessionId])

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase || !sessionId) return

    fetchLatest()

    const channel = supabase
      .channel(`error-healing:${sessionId}`)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .on('postgres_changes' as any, {
        event:  '*',
        schema: 'public',
        table:  'error_logs',
        filter: `session_id=eq.${sessionId}`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }, (payload: any) => {
        const row = (payload.new ?? payload.old) as ErrorLogRow
        if (row?.id) upsertRow(row)
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .subscribe((status: any) => {
        setState(prev => ({ ...prev, connected: status === 'SUBSCRIBED' }))
      })

    channelRef.current = channel
    return () => { disconnect() }
  }, [sessionId, fetchLatest, upsertRow, disconnect])

  return { ...state, disconnect, fetchLatest }
}
