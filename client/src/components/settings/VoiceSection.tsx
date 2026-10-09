import { useCallback, useEffect, useRef, useState } from 'react'
import { Keyboard, Mic, Square, Volume2 } from 'lucide-react'
import { blip } from '../../lib/fx'
import { keyLabel, setSetting, useSettings } from '../../lib/settings'
import { micProblem } from '../../lib/voice'
import { Choice, Group, SectionHead, Select, Slider, Toggle } from './controls'

type SinkCapable = { setSinkId?: (id: string) => Promise<void> }

const canPickOutput = typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype

export function VoiceSection() {
  const s = useSettings()
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    setDevices(await navigator.mediaDevices.enumerateDevices())
  }, [])

  useEffect(() => {
    void refresh()
    const md = navigator.mediaDevices
    md?.addEventListener?.('devicechange', refresh)
    return () => md?.removeEventListener?.('devicechange', refresh)
  }, [refresh])

  const inputs = devices.filter((d) => d.kind === 'audioinput')
  const outputs = devices.filter((d) => d.kind === 'audiooutput')
  // Пока нет разрешения на микрофон, браузер не отдаёт названия устройств
  const needsPermission = inputs.length > 0 && inputs.every((d) => !d.label)

  const askPermission = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())
      setError(null)
      await refresh()
    } catch (err) {
      setError(micProblem(err))
    }
  }

  const deviceOptions = (list: MediaDeviceInfo[], fallback: string, current: string) => {
    const options = [
      { value: '', label: 'По умолчанию (системное)' },
      ...list
        .filter((d) => d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
        .map((d, i) => ({ value: d.deviceId, label: d.label || `${fallback} ${i + 1}` })),
    ]
    // Выбранное устройство отключили — показываем это, а не делаем вид, что стоит «по умолчанию»
    if (current && !options.some((o) => o.value === current)) options.push({ value: current, label: 'Отключённое устройство' })
    return options
  }

  return (
    <>
      <SectionHead title="Голос и звук" subtitle="Настрой микрофон и звук заранее — голосовые каналы уже на подходе." />

      {!navigator.mediaDevices?.getUserMedia ? (
        <div className="notice">Этот браузер не умеет работать с микрофоном. Открой Nuntius в Chrome, Edge или Firefox.</div>
      ) : (
        <>
          {needsPermission && (
            <div className="notice">
              <span>Чтобы увидеть названия микрофонов и проверить звук, разреши доступ к микрофону.</span>
              <button className="btn btn--primary btn--sm" onClick={() => void askPermission()}>
                <Mic size={15} /> Разрешить доступ
              </button>
            </div>
          )}
          {error && <div className="notice notice--error">{error}</div>}

          <Group title="Устройства">
            <div className="set-grid">
              <Select
                label="Микрофон"
                value={s.inputDeviceId}
                options={deviceOptions(inputs, 'Микрофон', s.inputDeviceId)}
                onChange={(v) => setSetting('inputDeviceId', v)}
              />
              <Select
                label="Динамики / наушники"
                value={s.outputDeviceId}
                options={deviceOptions(outputs, 'Устройство вывода', s.outputDeviceId)}
                disabled={!canPickOutput}
                onChange={(v) => setSetting('outputDeviceId', v)}
              />
            </div>
            {!canPickOutput && <p className="muted">Этот браузер не даёт выбрать устройство вывода — звук идёт в системное по умолчанию.</p>}
            <FindMic onFound={refresh} />
            <div className="set-grid">
              <Slider label="Громкость микрофона" value={s.inputVolume} min={0} max={200} step={5} format={(v) => `${v}%`} onChange={(v) => setSetting('inputVolume', v)} />
              <Slider label="Громкость звука" value={s.outputVolume} min={0} max={200} step={5} format={(v) => `${v}%`} onChange={(v) => setSetting('outputVolume', v)} />
            </div>
          </Group>

          <MicTest onError={setError} />
        </>
      )}

      <Group title="Режим ввода">
        <Choice
          value={s.inputMode}
          onChange={(v) => setSetting('inputMode', v)}
          options={[
            { value: 'voice', label: 'Голосовая активация', hint: 'Микрофон включается сам, когда ты говоришь громче порога' },
            { value: 'ptt', label: 'Нажми и говори', hint: 'Слышно, только пока держишь клавишу' },
          ]}
        />
        {s.inputMode === 'voice' ? (
          <Slider
            label="Чувствительность"
            hint="Порог отмечен чертой на индикаторе проверки: всё, что громче — будет слышно"
            value={s.sensitivity}
            min={0}
            max={100}
            format={(v) => `${v}%`}
            onChange={(v) => setSetting('sensitivity', v)}
          />
        ) : (
          <PttKey />
        )}
      </Group>

      <Group title="Обработка голоса">
        <Toggle label="Шумоподавление" hint="Убирает гул, клавиатуру и вентилятор" checked={s.noiseSuppression} onChange={(v) => setSetting('noiseSuppression', v)} />
        <Toggle label="Эхоподавление" hint="Чтобы друзья не слышали себя из твоих колонок" checked={s.echoCancellation} onChange={(v) => setSetting('echoCancellation', v)} />
        <Toggle label="Автоматическая громкость" hint="Выравнивает тихий и громкий голос" checked={s.autoGain} onChange={(v) => setSetting('autoGain', v)} />
      </Group>
    </>
  )
}

/** Проверка микрофона: живой индикатор уровня + (по желанию) слышать себя */
const STUCK =
  'Микрофон не отвечает. Скорее всего, его держит другая программа или Windows не пускает к нему: Параметры → Конфиденциальность и защита → Микрофон → «Разрешить классическим приложениям доступ к микрофону»'
const SILENT =
  'Микрофон открылся, но звука от него нет совсем. Так бывает, когда приложение не пускает антивирус (например, у Kaspersky есть защита микрофона — разреши в ней Nuntius) или Windows (Параметры → Конфиденциальность и защита → Микрофон). Ещё проверь, что выше выбран нужный микрофон'

function MicTest({ onError }: { onError: (text: string | null) => void }) {
  const s = useSettings()
  const [testing, setTesting] = useState(false)
  const [loopback, setLoopback] = useState(false)
  const meterRef = useRef<HTMLDivElement>(null)
  // Какой микрофон на самом деле открылся — чтобы было видно, тот ли
  const [opened, setOpened] = useState<string | null>(null)
  // Громкость и порог меняются на лету — без перезапуска микрофона
  const live = useRef({ inputVolume: s.inputVolume, outputVolume: s.outputVolume, sensitivity: s.sensitivity })
  live.current = { inputVolume: s.inputVolume, outputVolume: s.outputVolume, sensitivity: s.sensitivity }

  useEffect(() => {
    if (!testing) return
    let cancelled = false
    let raf = 0
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null

    // Windows иногда не отдаёт микрофон и молчит — без ответа не висим
    const slow = window.setTimeout(() => {
      if (!cancelled && !stream) onError(STUCK)
    }, 8000)

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: s.inputDeviceId ? { ideal: s.inputDeviceId } : undefined,
            noiseSuppression: s.noiseSuppression,
            echoCancellation: s.echoCancellation,
            autoGainControl: s.autoGain,
          },
        })
      } catch (err) {
        window.clearTimeout(slow)
        if (cancelled) return
        onError(micProblem(err))
        setTesting(false)
        return
      }
      window.clearTimeout(slow)
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      onError(null)
      setOpened(stream.getAudioTracks()[0]?.label || 'микрофон без названия')
      ctx = new AudioContext()
      if (s.outputDeviceId && (ctx as SinkCapable).setSinkId) await (ctx as SinkCapable).setSinkId!(s.outputDeviceId).catch(() => {})
      // Пока ждали устройство вывода, проверку могли остановить — тогда всё уже закрыто
      if (cancelled) return
      const source = ctx.createMediaStreamSource(stream)
      const inGain = ctx.createGain()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      source.connect(inGain).connect(analyser)
      const outGain = ctx.createGain()
      if (loopback) analyser.connect(outGain).connect(ctx.destination)

      const buf = new Float32Array(analyser.fftSize)
      let shown = 0
      // Живой микрофон всегда хоть чуть-чуть шумит. Ровные нули несколько секунд —
      // значит, звук не пускают (Windows, антивирус) или открылось не то устройство
      const since = performance.now()
      let heard = false
      let warned = false
      const tick = () => {
        if (cancelled) return
        inGain.gain.value = live.current.inputVolume / 100
        outGain.gain.value = live.current.outputVolume / 100
        analyser.getFloatTimeDomainData(buf)
        let sum = 0
        for (const v of buf) sum += v * v
        if (sum > 0 && !heard) {
          heard = true
          if (warned) onError(null)
        }
        if (!heard && !warned && performance.now() - since > 4000) {
          warned = true
          onError(SILENT)
        }
        const db = 20 * Math.log10(Math.sqrt(sum / buf.length) + 1e-8)
        const level = Math.min(1, Math.max(0, (db + 60) / 60)) // −60 дБ … 0 дБ → 0 … 1
        shown = level > shown ? level : shown * 0.9 + level * 0.1 // быстро вверх, плавно вниз
        const el = meterRef.current
        if (el) {
          el.style.setProperty('--level', `${shown * 100}%`)
          el.classList.toggle('is-open', shown * 100 >= live.current.sensitivity)
        }
        raf = requestAnimationFrame(tick)
      }
      tick()
    }
    void start()

    return () => {
      cancelled = true
      window.clearTimeout(slow)
      setOpened(null)
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
      void ctx?.close()
      meterRef.current?.style.setProperty('--level', '0%')
      meterRef.current?.classList.remove('is-open')
    }
  }, [testing, loopback, s.inputDeviceId, s.outputDeviceId, s.noiseSuppression, s.echoCancellation, s.autoGain, onError])

  return (
    <Group title="Проверка микрофона">
      <div className="mic-test">
        <button className={`btn ${testing ? 'btn--outline' : 'btn--primary'}`} onClick={() => setTesting((v) => !v)}>
          {testing ? <Square size={15} /> : <Mic size={16} />} {testing ? 'Остановить' : 'Проверить'}
        </button>
        <div className={`meter${testing ? ' is-live' : ''}`} ref={meterRef}>
          <div className="meter__fill" />
          {s.inputMode === 'voice' && <div className="meter__threshold" style={{ left: `${s.sensitivity}%` }} />}
        </div>
        <button className="btn btn--ghost btn--sm" onClick={() => void blip(true)} data-tip="Сыграть звук уведомления">
          <Volume2 size={15} /> Звук
        </button>
      </div>
      <p className="muted">{testing ? 'Скажи что-нибудь — полоска должна прыгать. Белая черта — порог голосовой активации.' : 'Нажми «Проверить» и скажи что-нибудь.'}</p>
      {testing && opened && <p className="muted">Слушаем: {opened}</p>}
      <Toggle label="Слышать себя" hint="Только в наушниках — иначе будет свист" checked={loopback} onChange={setLoopback} />
    </Group>
  )
}

const LISTEN_MS = 3500

/**
 * «Найти мой микрофон»: слушаем все микрофоны сразу, пока человек говорит, и выбираем тот,
 * где голос громче всего. Спасает, когда по умолчанию открывается не тот (у приложения для Windows
 * нет выбора микрофона из браузера). Если тишина везде — подсказываем, кто не пускает
 */
function FindMic({ onFound }: { onFound: () => Promise<void> }) {
  const [left, setLeft] = useState(0)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const run = async () => {
    setResult(null)
    const streams: { label: string; id: string; stream: MediaStream }[] = []
    let ctx: AudioContext | null = null
    try {
      // без разрешения браузер не покажет устройства — спрашиваем один раз
      const first = await navigator.mediaDevices.getUserMedia({ audio: true })
      first.getTracks().forEach((t) => t.stop())
      const list = (await navigator.mediaDevices.enumerateDevices()).filter(
        (d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications',
      )
      const opened = await Promise.allSettled(
        list.map((d) =>
          navigator.mediaDevices
            .getUserMedia({ audio: { deviceId: { exact: d.deviceId }, noiseSuppression: false, echoCancellation: false, autoGainControl: false } })
            .then((stream) => ({ label: d.label || 'Микрофон', id: d.deviceId, stream })),
        ),
      )
      for (const o of opened) if (o.status === 'fulfilled') streams.push(o.value)
      if (!streams.length) {
        setResult({ ok: false, text: 'Не открылся ни один микрофон. Проверь, что он подключён и что Windows и антивирус пускают к нему Nuntius' })
        return
      }
      ctx = new AudioContext()
      const c = ctx
      const meters = streams.map((x) => {
        const analyser = c.createAnalyser()
        analyser.fftSize = 1024
        c.createMediaStreamSource(x.stream).connect(analyser)
        return { ...x, analyser, buf: new Float32Array(analyser.fftSize), loudest: -Infinity, any: false }
      })
      const until = performance.now() + LISTEN_MS
      while (performance.now() < until) {
        setLeft(Math.ceil((until - performance.now()) / 1000))
        for (const m of meters) {
          m.analyser.getFloatTimeDomainData(m.buf)
          let sum = 0
          for (const v of m.buf) sum += v * v
          if (sum > 0) m.any = true
          m.loudest = Math.max(m.loudest, 20 * Math.log10(Math.sqrt(sum / m.buf.length) + 1e-12))
        }
        await new Promise((r) => window.setTimeout(r, 50))
      }
      const best = meters.reduce((a, b) => (b.loudest > a.loudest ? b : a))
      if (!meters.some((m) => m.any)) {
        setResult({
          ok: false,
          text: 'Все микрофоны дают полную тишину — звук не пускают. Чаще всего это антивирус (у Kaspersky есть защита микрофона — разреши в ней Nuntius) или Windows: Параметры → Конфиденциальность и защита → Микрофон',
        })
      } else if (best.loudest < -55) {
        setResult({ ok: false, text: `Голоса не слышно ни в одном микрофоне (громче всех «${best.label}»). Проверь, что микрофон включён — на гарнитуре бывает кнопка выключения` })
      } else {
        setSetting('inputDeviceId', best.id)
        setResult({ ok: true, text: `Нашёл: «${best.label}» — выбран. Нажми «Проверить» ниже, полоска должна прыгать` })
        await onFound()
      }
    } catch (err) {
      setResult({ ok: false, text: micProblem(err) })
    } finally {
      for (const x of streams) x.stream.getTracks().forEach((t) => t.stop())
      void ctx?.close()
      setLeft(0)
    }
  }

  return (
    <div className="find-mic">
      <button className="btn btn--outline btn--sm" disabled={left > 0} onClick={() => void run()}>
        <Mic size={15} /> {left > 0 ? `Говори что-нибудь… ${left}` : 'Найти мой микрофон'}
      </button>
      {!result && left === 0 && <span className="muted">Не слышно? Нажми и говори 3 секунды — сам выберу микрофон, в котором тебя слышно</span>}
      {result && <div className={`notice${result.ok ? '' : ' notice--error'}`}>{result.text}</div>}
    </div>
  )
}

/** Назначение клавиши для «нажми и говори» */
function PttKey() {
  const pttKey = useSettings((st) => st.pttKey)
  const [capturing, setCapturing] = useState(false)

  useEffect(() => {
    if (!capturing) return
    const onKey = (e: KeyboardEvent) => {
      // ловим до всех остальных (в т.ч. до ESC, закрывающего настройки)
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.code !== 'Escape') setSetting('pttKey', e.code)
      setCapturing(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [capturing])

  return (
    <div className="ptt">
      <div className="toggle-row__text">
        <span className="toggle-row__label">Клавиша</span>
        <span className="toggle-row__hint">{capturing ? 'Нажми нужную клавишу… (ESC — отмена)' : 'Держи её, когда говоришь'}</span>
      </div>
      <button className={`ptt__key${capturing ? ' is-capturing' : ''}`} onClick={() => setCapturing(true)}>
        <Keyboard size={16} />
        {capturing ? '…' : keyLabel(pttKey)}
      </button>
    </div>
  )
}
