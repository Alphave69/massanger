import { useCallback, useEffect, useRef, useState } from 'react'
import { Keyboard, Mic, Square, Volume2 } from 'lucide-react'
import { blip } from '../../lib/fx'
import { keyLabel, setSetting, useSettings } from '../../lib/settings'
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
    } catch {
      setError('Браузер не дал доступ к микрофону. Разреши его в настройках сайта (значок слева от адреса) и попробуй снова.')
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
function MicTest({ onError }: { onError: (text: string | null) => void }) {
  const s = useSettings()
  const [testing, setTesting] = useState(false)
  const [loopback, setLoopback] = useState(false)
  const meterRef = useRef<HTMLDivElement>(null)
  // Громкость и порог меняются на лету — без перезапуска микрофона
  const live = useRef({ inputVolume: s.inputVolume, outputVolume: s.outputVolume, sensitivity: s.sensitivity })
  live.current = { inputVolume: s.inputVolume, outputVolume: s.outputVolume, sensitivity: s.sensitivity }

  useEffect(() => {
    if (!testing) return
    let cancelled = false
    let raf = 0
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null

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
      } catch {
        if (cancelled) return
        onError('Не получилось включить микрофон. Проверь, что он подключён и браузеру разрешён доступ.')
        setTesting(false)
        return
      }
      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      onError(null)
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
      const tick = () => {
        if (cancelled) return
        inGain.gain.value = live.current.inputVolume / 100
        outGain.gain.value = live.current.outputVolume / 100
        analyser.getFloatTimeDomainData(buf)
        let sum = 0
        for (const v of buf) sum += v * v
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
      <Toggle label="Слышать себя" hint="Только в наушниках — иначе будет свист" checked={loopback} onChange={setLoopback} />
    </Group>
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
