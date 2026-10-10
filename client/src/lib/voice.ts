import { create } from 'zustand'
import type { Socket } from 'socket.io-client'
import { useSettings } from './settings'
import { chat, useChat } from './store'
import { desktopNotify, tone, toneLoop } from './fx'
import { ui } from './ui'
import { can, guildOfChannel } from './perms'
import { isDesktopApp } from './platform'

/**
 * Голосовой движок.
 *
 * Звук идёт напрямую между участниками (WebRTC, «каждый с каждым»), сервер только пересылает
 * служебные сообщения. Чтобы два человека не «столкнулись», договариваясь об одном соединении,
 * используем схему perfect negotiation из спецификации WebRTC: один из пары «вежливый» и уступает.
 *
 * Микрофон: mic → громкость → «ворота» (AudioWorklet: порог голоса / нажми-и-говори / mute) → в звонок.
 * Ворота работают в аудиопотоке, поэтому не тормозят в свёрнутой вкладке (таймеры там замедляются).
 */

import type { VoiceMember } from './api'
export type { VoiceMember }

interface VoiceState {
  /** Кто сидит в каких комнатах (то, что нам видно) */
  rooms: Record<string, VoiceMember[]>
  /** Комната, где сидим мы */
  roomId: string | null
  status: 'idle' | 'connecting' | 'connected'
  /** Кто сейчас говорит (только в нашей комнате, включая нас) */
  speaking: Record<string, boolean>
  /** Состояние соединения с каждым собеседником */
  peerStates: Record<string, RTCPeerConnectionState>
  /** Видео собеседников: id потока → поток */
  remoteStreams: Record<string, MediaStream>
  localCamera: MediaStream | null
  localScreen: MediaStream | null
  /** Входящие звонки */
  incoming: { roomId: string; from: string }[]
  /** Звоним и ждём ответа (в личке/группе, пока никто не пришёл) */
  calling: string | null
  noMic: boolean
  ping: number | null
  /** Громкость каждого человека для меня (0…200 %) и «заглушить для себя» */
  volumes: Record<string, number>
  localMutes: Record<string, boolean>
}

const VOLUMES_KEY = 'nuntius.volumes'

function loadVolumes(): Pick<VoiceState, 'volumes' | 'localMutes'> {
  try {
    const raw = JSON.parse(localStorage.getItem(VOLUMES_KEY) ?? '{}')
    return { volumes: raw.volumes ?? {}, localMutes: raw.localMutes ?? {} }
  } catch {
    return { volumes: {}, localMutes: {} }
  }
}

const IDLE: Omit<VoiceState, 'rooms' | 'incoming' | 'volumes' | 'localMutes'> = {
  roomId: null,
  status: 'idle',
  speaking: {},
  peerStates: {},
  remoteStreams: {},
  localCamera: null,
  localScreen: null,
  calling: null,
  noMic: false,
  ping: null,
}

export const useVoice = create<VoiceState>(() => ({ ...IDLE, rooms: {}, incoming: [], ...loadVolumes() }))

const set = useVoice.setState
const get = useVoice.getState

// ============ внутреннее состояние движка ============

interface Peer {
  userId: string
  joinedAt: number
  pc: RTCPeerConnection
  polite: boolean
  makingOffer: boolean
  ignoreOffer: boolean
  tracksAdded: boolean
  /** Сигналы обрабатываем строго по очереди */
  queue: Promise<void>
  voiceStreamId: string | null
  voice?: RemoteAudio
  screenAudio?: RemoteAudio
  cameraSenders: RTCRtpSender[]
  screenSenders: RTCRtpSender[]
}

interface RemoteAudio {
  el: HTMLAudioElement
  source: MediaStreamAudioSourceNode
  gain: GainNode
  analyser: AnalyserNode
}

let socket: Socket | null = null
let ctx: AudioContext | null = null
let master: GainNode | null = null
let inputGain: GainNode | null = null
let gate: AudioWorkletNode | null = null
let outgoing: MediaStreamAudioDestinationNode | null = null
let micStream: MediaStream | null = null
let micSource: MediaStreamAudioSourceNode | null = null
let selfLevel = { level: 0, open: false }
let iceServers: RTCIceServer[] = []
const peers = new Map<string, Peer>()
let timers: number[] = []
let stopRingback: (() => void) | null = null
let stopRingtone: (() => void) | null = null
let pttDown = false

const meId = () => useChat.getState().me?.id ?? ''

/** Нас заглушил модератор (или в канале нет права говорить) — микрофон закрыт, пока не снимут */
export function selfServerMuted(s: Pick<VoiceState, 'roomId' | 'rooms'> = get()): boolean {
  if (!s.roomId) return false
  return Boolean(s.rooms[s.roomId]?.find((m) => m.userId === meId())?.serverMuted)
}

/** Можно ли включать камеру и экран в комнате (в личках — всегда, на сервере — с правом VIDEO) */
export function videoAllowed(roomId: string | null = get().roomId): boolean {
  if (!roomId) return true
  const guild = guildOfChannel(useChat.getState().guilds, roomId)
  return !guild || can(guild, 'VIDEO', roomId)
}

const NO_VIDEO = { title: 'Видео недоступно', text: 'Нет прав на видео в этом канале' }
type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void> }

// ============ «ворота» для микрофона (AudioWorklet) ============

const GATE_WORKLET = `
class NuntiusGate extends AudioWorkletProcessor {
  constructor() {
    super()
    this.mode = 'voice'; this.threshold = 0.35; this.ptt = false; this.muted = false
    this.hold = 0; this.gain = 0; this.peak = 0; this.blocks = 0
    this.port.onmessage = (e) => Object.assign(this, e.data)
  }
  process(inputs, outputs) {
    const input = inputs[0] || []
    const output = outputs[0]
    const ch = input[0]
    let sum = 0
    if (ch) for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i]
    const rms = ch ? Math.sqrt(sum / ch.length) : 0
    const level = Math.min(1, Math.max(0, (20 * Math.log10(rms + 1e-8) + 60) / 60))
    this.peak = Math.max(level, this.peak * 0.92)
    let open
    if (this.muted) open = false
    else if (this.mode === 'ptt') open = this.ptt
    else {
      if (level >= this.threshold) this.hold = Math.round((sampleRate * 0.35) / 128)
      else if (this.hold > 0) this.hold--
      open = this.hold > 0
    }
    const target = open ? 1 : 0
    for (let c = 0; c < output.length; c++) {
      const src = input[c] || input[0]
      const dst = output[c]
      let g = this.gain
      for (let i = 0; i < dst.length; i++) {
        g += (target - g) * 0.03
        dst[i] = src ? src[i] * g : 0
      }
      if (c === output.length - 1) this.gain = g
    }
    if (++this.blocks % 8 === 0) this.port.postMessage({ level: this.peak, open })
    return true
  }
}
registerProcessor('nuntius-gate', NuntiusGate)
`

async function ensureAudio() {
  if (!ctx) {
    // Собираем всё в локальных переменных: если что-то сломается на полпути, в следующий раз начнём с нуля
    const c = new AudioContext()
    try {
      if (!c.audioWorklet) throw new Error('AudioWorklet недоступен (нужен https или localhost)')
      const url = URL.createObjectURL(new Blob([GATE_WORKLET], { type: 'application/javascript' }))
      try {
        await c.audioWorklet.addModule(url)
      } finally {
        URL.revokeObjectURL(url)
      }
      const m = c.createGain()
      m.connect(c.destination)
      const input = c.createGain()
      const g = new AudioWorkletNode(c, 'nuntius-gate', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })
      const out = c.createMediaStreamDestination()
      input.connect(g).connect(out)
      g.port.onmessage = (e) => {
        selfLevel = e.data
        const speaking = Boolean(e.data.open && e.data.level > 0.12)
        if (get().speaking[meId()] !== speaking && get().roomId) set((s) => ({ speaking: { ...s.speaking, [meId()]: speaking } }))
      }
      ;[ctx, master, inputGain, gate, outgoing] = [c, m, input, g, out]
    } catch (err) {
      void c.close().catch(() => {})
      throw err
    }
  }
  if (ctx.state === 'suspended') await ctx.resume().catch(() => {})
  await applySink()
  applyGate()
  applyVolumes()
}

async function applySink() {
  const c = ctx as SinkContext | null
  const id = useSettings.getState().outputDeviceId
  if (c?.setSinkId) await c.setSinkId(id).catch(() => {})
}

/**
 * Открыть микрофон из настроек. Выбранный просим строго (exact): «мягкую» просьбу (ideal) новый Chromium
 * пропускает и берёт системный по умолчанию — в приложении для Windows так открывался не тот микрофон.
 * Выбранный не открылся (выдернули, занят) — берём системный, а onFallback говорит об этом
 */
export async function openMic(onFallback?: (text: string) => void): Promise<MediaStream> {
  const s = useSettings.getState()
  const audio = { noiseSuppression: s.noiseSuppression, echoCancellation: s.echoCancellation, autoGainControl: s.autoGain }
  if (s.inputDeviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { ...audio, deviceId: { exact: s.inputDeviceId } }, video: false })
    } catch (err) {
      // запрет доступа на другом микрофоне будет тем же — сразу наверх
      if (err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) throw err
      onFallback?.(`Выбранный микрофон не открылся${err instanceof DOMException ? ` (${err.name})` : ''} — взяли системный по умолчанию. Выбрать другой: Настройки → Голос и звук`)
    }
  }
  return navigator.mediaDevices.getUserMedia({ audio, video: false })
}

/** Взять микрофон с текущими настройками (при смене устройства/обработки — заново, без переподключения) */
async function acquireMic(quiet = false) {
  if (!ctx || !inputGain) return
  try {
    const stream = await openMic((text) => {
      if (!quiet) chat.toast({ title: 'Микрофон', text })
    })
    if (!get().roomId) {
      stream.getTracks().forEach((t) => t.stop())
      return
    }
    releaseMic()
    micStream = stream
    micSource = ctx.createMediaStreamSource(stream)
    micSource.connect(inputGain)
    // Выдернули гарнитуру — берём микрофон заново (браузер даст тот, что остался)
    stream.getAudioTracks()[0]?.addEventListener('ended', () => {
      if (micStream !== stream || !get().roomId) return
      chat.toast({ title: 'Микрофон отключился', text: 'Переключаемся на другой' })
      void acquireMic()
    })
    if (get().noMic) {
      set({ noMic: false })
      sendState({ muted: useSettings.getState().muted })
    }
  } catch (err) {
    if (!get().noMic) {
      set({ noMic: true })
      sendState({ muted: true })
    }
    if (!quiet) chat.toast({ title: 'Нет доступа к микрофону', text: micProblem(err) })
  }
  applyGate()
}

/** Почему не дали микрофон — по названию ошибки, чтобы было понятно, что чинить */
export function micProblem(err: unknown): string {
  const name = err instanceof DOMException ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return isDesktopApp()
      ? 'Windows не пускает приложение к микрофону: Параметры → Конфиденциальность и защита → Микрофон → включи «Доступ к микрофону» и «Разрешить классическим приложениям доступ к микрофону»'
      : 'Браузер запретил микрофон: нажми на значок слева от адреса сайта и разреши микрофон'
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return 'Микрофон занят другой программой или не отвечает. Закрой её или выбери другой микрофон в настройках → Голос и звук'
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'Микрофон не найден. Подключи его или выбери другой в настройках → Голос и звук'
  }
  return `Ты в голосе, но тебя не слышно. Проверь микрофон в настройках${name ? ` (${name})` : ''}`
}

// Подключили микрофон, пока сидим без него, — пробуем взять
navigator.mediaDevices?.addEventListener?.('devicechange', () => {
  if (get().roomId && get().noMic) void acquireMic(true)
})

function releaseMic() {
  micSource?.disconnect()
  micSource = null
  micStream?.getTracks().forEach((t) => t.stop())
  micStream = null
}

/** Передать «воротам» режим, порог, mute и нажатие клавиши */
function applyGate() {
  const s = useSettings.getState()
  gate?.port.postMessage({
    mode: s.inputMode,
    threshold: s.sensitivity / 100,
    muted: s.muted || s.deafened || get().noMic || selfServerMuted(),
    ptt: pttDown,
  })
  if (inputGain) inputGain.gain.value = s.inputVolume / 100
}

/** Громкость: общая (и «выключить звук») + у каждого человека своя */
function applyVolumes() {
  const s = useSettings.getState()
  if (master) master.gain.value = s.deafened ? 0 : s.outputVolume / 100
  const { volumes, localMutes } = get()
  for (const peer of peers.values()) {
    const v = localMutes[peer.userId] ? 0 : (volumes[peer.userId] ?? 100) / 100
    if (peer.voice) peer.voice.gain.gain.value = v
    if (peer.screenAudio) peer.screenAudio.gain.gain.value = v
  }
}

// ============ соединения с собеседниками ============

const signal = (to: string, data: unknown) => socket?.emit('voice:signal', { to, data })

function setPeerState(userId: string, state: RTCPeerConnectionState | null) {
  set((s) => {
    const peerStates = { ...s.peerStates }
    if (state) peerStates[userId] = state
    else delete peerStates[userId]
    return { peerStates }
  })
}

function createPeer(userId: string, joinedAt: number, initiator: boolean): Peer {
  closePeer(userId)
  const pc = new RTCPeerConnection({ iceServers })
  const peer: Peer = {
    userId,
    joinedAt,
    pc,
    polite: meId() < userId,
    makingOffer: false,
    ignoreOffer: false,
    tracksAdded: false,
    queue: Promise.resolve(),
    voiceStreamId: null,
    cameraSenders: [],
    screenSenders: [],
  }
  peers.set(userId, peer)
  setPeerState(userId, pc.connectionState)

  pc.onnegotiationneeded = async () => {
    try {
      peer.makingOffer = true
      await pc.setLocalDescription()
      signal(userId, { description: pc.localDescription?.toJSON() })
    } catch (err) {
      console.warn('voice: offer failed', err)
    } finally {
      peer.makingOffer = false
    }
  }
  pc.onicecandidate = (e) => e.candidate && signal(userId, { candidate: e.candidate.toJSON() })
  pc.ontrack = (e) => onRemoteTrack(peer, e)
  pc.onconnectionstatechange = () => {
    setPeerState(userId, pc.connectionState)
    if (pc.connectionState === 'failed') pc.restartIce()
  }
  // договорились (в том числе после включения экрана посреди звонка) — потолки для экрана
  pc.onsignalingstatechange = () => pc.signalingState === 'stable' && tunePeerScreen(peer)
  if (initiator) addLocalTracks(peer)
  tuneScreenSenders() // зрителей стало больше — всем потолок пониже
  return peer
}

/**
 * Демонстрация экрана: потолок разрешения и битрейта для каждого зрителя.
 * Связь «каждый с каждым» — экран кодируется отдельно для каждого, а Chromium при нехватке сил
 * держит резкость и роняет кадры: без потолка у 3–5 зрителей выходило 1–2 кадра в секунду.
 * 1–2 зрителя — до 1080p, больше — до 720p; общий исходящий поток ~6 Мбит/с делим на всех
 */
function screenLimits() {
  const viewers = Math.max(1, peers.size)
  return {
    maxHeight: viewers >= 3 ? 720 : 1080,
    maxBitrate: Math.max(800_000, Math.min(2_500_000, Math.floor(6_000_000 / viewers))),
  }
}

function tunePeerScreen(peer: Peer) {
  const limits = screenLimits()
  for (const sender of peer.screenSenders) void tuneScreenSender(sender, limits)
}

function tuneScreenSenders() {
  for (const peer of peers.values()) tunePeerScreen(peer)
}

async function tuneScreenSender(sender: RTCRtpSender, { maxHeight, maxBitrate }: ReturnType<typeof screenLimits>) {
  const track = sender.track
  if (track?.kind !== 'video') return
  const { width = 0, height = 0 } = track.getSettings()
  const scaleResolutionDownBy = Math.max(1, height / maxHeight, width / ((maxHeight * 16) / 9))
  try {
    const params = sender.getParameters()
    if (!params.encodings?.length) return // ещё не договорились — настроим, когда соединение встанет
    const [first] = params.encodings
    if (first.scaleResolutionDownBy === scaleResolutionDownBy && first.maxBitrate === maxBitrate && first.maxFramerate === 30) return
    params.encodings[0] = { ...first, scaleResolutionDownBy, maxBitrate, maxFramerate: 30 }
    await sender.setParameters(params)
  } catch {
    // соединение закрылось или занято договорённостью — настроим при следующей
  }
}

/**
 * Убрать камеру/экран из соединения. Transceiver останавливаем, а не просто снимаем дорожку:
 * тогда его место в SDP переиспользуется и описание соединения не растёт с каждым включением.
 */
function dropSenders(peer: Peer, senders: RTCRtpSender[]) {
  for (const sender of senders) {
    const transceiver = peer.pc.getTransceivers().find((t) => t.sender === sender)
    try {
      if (transceiver?.stop) transceiver.stop()
      else peer.pc.removeTrack(sender)
    } catch {
      // соединение уже закрыто
    }
  }
}

/** Свои дорожки — в соединение: голос всегда, камера и экран — если включены */
function addLocalTracks(peer: Peer) {
  if (peer.tracksAdded || !outgoing) return
  peer.tracksAdded = true
  for (const track of outgoing.stream.getAudioTracks()) peer.pc.addTrack(track, outgoing.stream)
  const { localCamera, localScreen } = get()
  if (localCamera) for (const t of localCamera.getTracks()) peer.cameraSenders.push(peer.pc.addTrack(t, localCamera))
  if (localScreen) for (const t of localScreen.getTracks()) peer.screenSenders.push(peer.pc.addTrack(t, localScreen))
}

async function handleSignal(peer: Peer, data: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit }) {
  const { pc } = peer
  if (data.description) {
    const offerCollision = data.description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable')
    peer.ignoreOffer = !peer.polite && offerCollision
    if (peer.ignoreOffer) return
    await pc.setRemoteDescription(data.description)
    if (data.description.type === 'offer') {
      // Первое предложение от нового собеседника: свои дорожки встают в его m-строки — хватает одного круга
      addLocalTracks(peer)
      await pc.setLocalDescription()
      signal(peer.userId, { description: pc.localDescription?.toJSON() })
    }
  } else if (data.candidate) {
    try {
      await pc.addIceCandidate(data.candidate)
    } catch (err) {
      if (!peer.ignoreOffer) throw err
    }
  }
}

function onSignal({ from, data }: { from: string; data: { description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit } }) {
  const { roomId, status, rooms } = get()
  if (!roomId || status === 'idle') return
  let peer = peers.get(from)
  if (!peer) {
    const member = rooms[roomId]?.find((m) => m.userId === from)
    peer = createPeer(from, member?.joinedAt ?? 0, false)
  }
  const p = peer
  p.queue = p.queue.then(() => handleSignal(p, data)).catch((err) => console.warn('voice: signal failed', err))
}

function makeRemoteAudio(stream: MediaStream): RemoteAudio {
  // Chrome: звук из WebRTC не идёт в WebAudio, пока поток не привязан к <audio> (беззвучному)
  const el = new Audio()
  el.muted = true
  el.srcObject = stream
  void el.play().catch(() => {})
  const source = ctx!.createMediaStreamSource(stream)
  const gain = ctx!.createGain()
  const analyser = ctx!.createAnalyser()
  analyser.fftSize = 512
  source.connect(analyser)
  source.connect(gain).connect(master!)
  return { el, source, gain, analyser }
}

function dropRemoteAudio(a?: RemoteAudio) {
  if (!a) return
  a.source.disconnect()
  a.gain.disconnect()
  a.el.srcObject = null
}

function onRemoteTrack(peer: Peer, e: RTCTrackEvent) {
  const stream = e.streams[0] ?? new MediaStream([e.track])
  if (e.track.kind === 'audio') {
    // Первый аудиопоток собеседника — его голос, остальные — звук демонстрации экрана
    if (!peer.voiceStreamId || peer.voiceStreamId === stream.id) {
      peer.voiceStreamId = stream.id
      dropRemoteAudio(peer.voice)
      peer.voice = makeRemoteAudio(stream)
    } else {
      dropRemoteAudio(peer.screenAudio)
      peer.screenAudio = makeRemoteAudio(stream)
    }
    applyVolumes()
    return
  }
  set((s) => ({ remoteStreams: { ...s.remoteStreams, [stream.id]: stream } }))
  const forget = () => {
    if (stream.getVideoTracks().some((t) => t.readyState === 'live')) return
    set((s) => {
      const remoteStreams = { ...s.remoteStreams }
      delete remoteStreams[stream.id]
      return { remoteStreams }
    })
  }
  e.track.addEventListener('ended', forget)
  stream.addEventListener('removetrack', forget)
}

function closePeer(userId: string) {
  const peer = peers.get(userId)
  if (!peer) return
  peers.delete(userId)
  peer.pc.onnegotiationneeded = null
  peer.pc.onicecandidate = null
  peer.pc.ontrack = null
  peer.pc.onconnectionstatechange = null
  peer.pc.onsignalingstatechange = null
  peer.pc.close()
  tuneScreenSenders() // зрителей меньше — остальным можно почётче
  dropRemoteAudio(peer.voice)
  dropRemoteAudio(peer.screenAudio)
  setPeerState(userId, null)
  set((s) => {
    const speaking = { ...s.speaking }
    delete speaking[userId]
    return { speaking }
  })
}

// ============ периодические проверки: кто говорит, пинг, гудки ============

function startLoops() {
  stopLoops()
  const buf = new Float32Array(512)
  timers.push(
    window.setInterval(() => {
      const speaking: Record<string, boolean> = { [meId()]: get().speaking[meId()] ?? false }
      for (const peer of peers.values()) {
        const a = peer.voice?.analyser
        if (!a) continue
        a.getFloatTimeDomainData(buf)
        let sum = 0
        for (const v of buf) sum += v * v
        speaking[peer.userId] = Math.sqrt(sum / buf.length) > 0.015
      }
      const prev = get().speaking
      if (Object.keys(speaking).some((k) => prev[k] !== speaking[k])) set({ speaking })
    }, 120),
    window.setInterval(() => void measurePing(), 2500),
  )
}

function stopLoops() {
  timers.forEach((t) => window.clearInterval(t))
  timers = []
}

async function measurePing() {
  const rtts: number[] = []
  for (const peer of peers.values()) {
    try {
      const stats = await peer.pc.getStats()
      stats.forEach((r) => {
        if (r.type === 'candidate-pair' && r.nominated && typeof r.currentRoundTripTime === 'number') rtts.push(r.currentRoundTripTime * 1000)
      })
    } catch {
      // соединение закрылось — пропускаем
    }
  }
  set({ ping: rtts.length ? Math.round(rtts.reduce((a, b) => a + b, 0) / rtts.length) : null })
}

function updateCalling() {
  const { calling, roomId, rooms } = get()
  const alone = roomId ? (rooms[roomId]?.length ?? 0) <= 1 : false
  if (calling && (!alone || calling !== roomId)) set({ calling: null })
  const shouldRing = Boolean(get().calling) && !useSettings.getState().deafened
  if (shouldRing && !stopRingback) stopRingback = toneLoop('ringback', 3000)
  if (!shouldRing && stopRingback) {
    stopRingback()
    stopRingback = null
  }
}

function updateRingtone() {
  const { incoming, roomId } = get()
  const ringing = incoming.some((c) => c.roomId !== roomId)
  const quiet = useChat.getState().me?.status === 'dnd' || useSettings.getState().deafened
  if (ringing && !quiet && !stopRingtone) stopRingtone = toneLoop('ring', 2200)
  if ((!ringing || quiet) && stopRingtone) {
    stopRingtone()
    stopRingtone = null
  }
}

useVoice.subscribe(() => {
  updateCalling()
  updateRingtone()
})

// ============ публичные действия ============

/** Номер попытки входа: ответ сервера на устаревшую попытку игнорируем */
let joinSeq = 0

export async function joinVoice(roomId: string) {
  const st = get()
  if (!socket || (st.roomId === roomId && st.status !== 'idle')) return
  const guild = guildOfChannel(useChat.getState().guilds, roomId)
  if (guild && !can(guild, 'CONNECT', roomId)) {
    chat.toast({ title: 'Нет доступа', text: 'У тебя нет права подключаться к этому каналу' })
    return
  }
  if (st.roomId) leaveVoice(false)
  const seq = ++joinSeq
  set({ roomId, status: 'connecting', incoming: st.incoming.filter((c) => c.roomId !== roomId) })

  try {
    await ensureAudio()
  } catch (err) {
    console.warn('voice: audio failed', err)
    set({ ...IDLE })
    chat.toast({ title: 'Голос не запустился', text: 'Браузер не дал включить звук. Обнови страницу и попробуй ещё раз' })
    return
  }
  await acquireMic()
  if (get().roomId !== roomId || seq !== joinSeq) return
  // Нет связи с сервером — зайдём, когда она вернётся (это сделает обработчик переподключения)
  if (socket.connected) sendJoin(roomId, seq)
}

/** Связь вернулась: соединения с людьми строим заново, а камеру, экран и микрофон не трогаем */
function rejoin(roomId: string) {
  stopLoops()
  for (const userId of [...peers.keys()]) closePeer(userId)
  set({ status: 'connecting', speaking: {}, ping: null })
  sendJoin(roomId, ++joinSeq, true)
}

function sendJoin(roomId: string, seq: number, again = false) {
  const s = useSettings.getState()
  socket?.timeout(10_000).emit(
    'voice:join',
    { roomId, muted: s.muted || get().noMic, deafened: s.deafened },
    (err: Error | null, res: { ok?: boolean; error?: string; members?: VoiceMember[]; iceServers?: RTCIceServer[]; ringing?: boolean }) => {
      if (get().roomId !== roomId || seq !== joinSeq) return
      if (err || !res?.ok) {
        teardown()
        chat.toast({ title: 'Не получилось подключиться', text: res?.error ?? 'Сервер не ответил' })
        return
      }
      iceServers = res.iceServers ?? []
      set({ status: 'connected', calling: res.ringing ? roomId : null })
      for (const m of res.members ?? []) createPeer(m.userId, m.joinedAt, true)
      const { localCamera, localScreen } = get()
      if (localCamera) sendState({ video: true, cameraStream: localCamera.id })
      if (localScreen) sendState({ screen: true, screenStream: localScreen.id })
      if (!again) tone('join')
      startLoops()
    },
  )
}

/** Освободить всё: соединения, камеру, экран, микрофон (без сообщения серверу) */
function teardown() {
  joinSeq++
  stopLoops()
  for (const userId of [...peers.keys()]) closePeer(userId)
  get().localCamera?.getTracks().forEach((t) => t.stop())
  get().localScreen?.getTracks().forEach((t) => t.stop())
  releaseMic()
  set({ ...IDLE })
}

export function leaveVoice(sound = true) {
  if (!get().roomId) return
  socket?.emit('voice:leave')
  teardown()
  if (sound) tone('leave')
}

function sendState(patch: Partial<VoiceMember>) {
  if (get().status === 'connected') socket?.emit('voice:update', patch)
}

export function toggleMute() {
  const s = useSettings.getState()
  // Сидим без микрофона — кнопка «включить микрофон» пробует взять его снова
  if (get().noMic && get().roomId) {
    useSettings.setState({ muted: false, deafened: false })
    void acquireMic()
    return
  }
  if (s.deafened) {
    // как в Discord: включить микрофон при выключенном звуке — значит включить и звук
    useSettings.setState({ deafened: false, muted: false })
  } else {
    useSettings.setState({ muted: !s.muted })
  }
}

export function toggleDeafen() {
  const s = useSettings.getState()
  useSettings.setState({ deafened: !s.deafened })
}

/** Камера/экран уже включаются (ждём окно разрешения) — второй клик не должен открыть второй поток */
let cameraBusy = false
let screenBusy = false

export async function toggleCamera() {
  const { localCamera } = get()
  if (localCamera) {
    localCamera.getTracks().forEach((t) => t.stop())
    for (const peer of peers.values()) {
      dropSenders(peer, peer.cameraSenders)
      peer.cameraSenders = []
    }
    set({ localCamera: null })
    sendState({ video: false, cameraStream: null })
    return
  }
  if (cameraBusy) return
  if (!videoAllowed()) return chat.toast(NO_VIDEO)
  cameraBusy = true
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } } })
    if (!get().roomId || get().localCamera) return stream.getTracks().forEach((t) => t.stop())
    set({ localCamera: stream })
    sendState({ video: true, cameraStream: stream.id })
    for (const peer of peers.values()) for (const t of stream.getTracks()) peer.cameraSenders.push(peer.pc.addTrack(t, stream))
    stream.getVideoTracks()[0]?.addEventListener('ended', () => get().localCamera === stream && void toggleCamera())
  } catch {
    chat.toast({ title: 'Камера не включилась', text: 'Проверь, что камера подключена и браузеру разрешён доступ' })
  } finally {
    cameraBusy = false
  }
}

export async function toggleScreen() {
  const { localScreen } = get()
  if (localScreen) {
    localScreen.getTracks().forEach((t) => t.stop())
    for (const peer of peers.values()) {
      dropSenders(peer, peer.screenSenders)
      peer.screenSenders = []
    }
    set({ localScreen: null })
    sendState({ screen: false, screenStream: null })
    return
  }
  if (!navigator.mediaDevices?.getDisplayMedia) {
    chat.toast({ title: 'Демонстрация экрана недоступна', text: 'Этот браузер так не умеет — попробуй Chrome или Edge на компьютере' })
    return
  }
  if (screenBusy) return
  if (!videoAllowed()) return chat.toast(NO_VIDEO)
  screenBusy = true
  try {
    // Звук системы — без звука самого Nuntius: иначе собеседники услышали бы себя с задержкой
    // Больше 1080p30 не снимаем: 1440p и 4K в разы дороже кодировать, а смотрят всё равно в окошке
    const options = {
      video: { width: { max: 1920 }, height: { max: 1080 }, frameRate: { ideal: 30, max: 30 } },
      audio: { restrictOwnAudio: true, suppressLocalAudioPlayback: false },
      systemAudio: 'include',
    } as DisplayMediaStreamOptions
    const stream = await navigator.mediaDevices.getDisplayMedia(options)
    if (!get().roomId || get().localScreen) return stream.getTracks().forEach((t) => t.stop())
    set({ localScreen: stream })
    sendState({ screen: true, screenStream: stream.id })
    for (const peer of peers.values()) for (const t of stream.getTracks()) peer.screenSenders.push(peer.pc.addTrack(t, stream))
    tuneScreenSenders()
    // «Прекратить доступ» в панели браузера
    stream.getVideoTracks()[0]?.addEventListener('ended', () => get().localScreen === stream && void toggleScreen())
  } catch {
    // пользователь передумал в окне выбора экрана — это не ошибка
  } finally {
    screenBusy = false
  }
}

/** Модерация голоса на сервере: заглушить / снять заглушение / отключить человека (нужны права в канале) */
export function moderateVoice(userId: string, action: 'mute' | 'unmute' | 'disconnect'): Promise<boolean> {
  return new Promise((resolve) => {
    if (!socket?.connected) {
      chat.toast({ title: 'Не получилось', text: 'Нет связи с сервером' })
      return resolve(false)
    }
    socket.timeout(5000).emit('voice:moderate', { userId, action }, (err: Error | null, res: { ok?: boolean; error?: string }) => {
      if (err || !res?.ok) {
        chat.toast({ title: 'Не получилось', text: res?.error ?? 'Сервер не ответил' })
        return resolve(false)
      }
      resolve(true)
    })
  })
}

export function setUserVolume(userId: string, volume: number) {
  set((s) => ({ volumes: { ...s.volumes, [userId]: volume } }))
  saveVolumes()
  applyVolumes()
}

export function toggleLocalMute(userId: string) {
  set((s) => ({ localMutes: { ...s.localMutes, [userId]: !s.localMutes[userId] } }))
  saveVolumes()
  applyVolumes()
}

function saveVolumes() {
  try {
    const { volumes, localMutes } = get()
    localStorage.setItem(VOLUMES_KEY, JSON.stringify({ volumes, localMutes }))
  } catch {
    // нет доступа к хранилищу — не страшно
  }
}

/** Системные уведомления о входящих звонках — закрываем, когда звонок уже не актуален */
const ringNotes = new Map<string, Notification>()

function closeRingNote(roomId: string) {
  ringNotes.get(roomId)?.close()
  ringNotes.delete(roomId)
}

export function acceptCall(roomId: string) {
  closeRingNote(roomId)
  ui.closeOverlays()
  chat.setView({ kind: 'dm', dmId: roomId })
  void joinVoice(roomId)
}

export function declineCall(roomId: string) {
  closeRingNote(roomId)
  socket?.emit('call:decline', { roomId })
  set((s) => ({ incoming: s.incoming.filter((c) => c.roomId !== roomId) }))
}

export const selfVoiceLevel = () => selfLevel

// ============ связь с сокетом ============

export function initVoice(rooms: Record<string, VoiceMember[]>, rings: { roomId: string; from: string }[]) {
  set({ rooms, incoming: rings })
}

export function resetVoice() {
  if (get().roomId) teardown()
  set({ ...IDLE, rooms: {}, incoming: [] })
}

export function attachVoice(s: Socket) {
  socket = s
  let connectedBefore = false

  s.on('connect', () => {
    // Связь восстановилась (или впервые появилась, пока мы входили) — заходим в голос заново
    const roomId = get().roomId
    if (roomId && (connectedBefore || get().status === 'connecting')) rejoin(roomId)
    connectedBefore = true
  })

  s.on('voice:room', ({ roomId, members }: { roomId: string; members: VoiceMember[] }) => {
    const wasMuted = selfServerMuted()
    set((st) => {
      const rooms = { ...st.rooms }
      if (members.length) rooms[roomId] = members
      else delete rooms[roomId]
      return { rooms }
    })
    if (roomId !== get().roomId) return
    // Модератор заглушил или снял заглушение — «ворота» микрофона закрываются сразу, без нашего участия
    const nowMuted = selfServerMuted()
    if (nowMuted !== wasMuted && members.some((m) => m.userId === meId())) {
      applyGate()
      tone(nowMuted ? 'mute' : 'unmute')
      const guild = guildOfChannel(useChat.getState().guilds, roomId)
      if (nowMuted && guild && !can(guild, 'SPEAK', roomId)) chat.toast({ title: 'Только слушать', text: 'В этом канале у тебя нет права говорить' })
      else if (nowMuted) chat.toast({ title: 'Тебя заглушили', text: 'Модератор выключил тебе микрофон на сервере' })
      else chat.toast({ title: 'Можно говорить', text: 'Заглушение на сервере снято' })
    }
    // Кто ушёл или перезашёл — закрываем старое соединение (новое предложит сам)
    for (const peer of [...peers.values()]) {
      const m = members.find((x) => x.userId === peer.userId)
      if (!m || (peer.joinedAt && m.joinedAt !== peer.joinedAt)) {
        if (!m) tone('leave-other')
        closePeer(peer.userId)
      } else if (!peer.joinedAt) {
        peer.joinedAt = m.joinedAt
      }
    }
    const known = new Set([meId(), ...peers.keys()])
    if (get().status === 'connected' && members.some((m) => !known.has(m.userId))) tone('join-other')
  })

  s.on('voice:signal', onSignal)

  s.on('voice:kicked', ({ reason }: { reason: string }) => {
    const wasIn = get().roomId
    teardown()
    // Ушёл сам (вышел с сервера, удалил канал) — говорить «тебя отключили» незачем
    if (reason === 'left' || !wasIn) return
    if (reason === 'disconnected') return chat.toast({ title: 'Голос отключён', text: 'Модератор отключил тебя от голоса' })
    const text =
      reason === 'moved'
        ? 'Ты подключился к голосу в другой вкладке'
        : reason === 'deleted'
          ? 'Канал или группу удалили'
          : 'Тебя убрали с сервера или из группы — или закрыли доступ к каналу'
    chat.toast({ title: 'Голос отключён', text })
  })

  s.on('call:ring', ({ roomId, from }: { roomId: string; from: string }) => {
    if (get().roomId === roomId) return
    set((st) => ({ incoming: [...st.incoming.filter((c) => c.roomId !== roomId), { roomId, from }] }))
    const caller = useChat.getState().users[from]
    if (useChat.getState().me?.status !== 'dnd') {
      closeRingNote(roomId)
      const note = desktopNotify(caller?.displayName ?? 'Звонок', 'звонит тебе в Nuntius', () => {
        // Пока уведомление висело, звонок мог закончиться — тогда просто открываем переписку
        if (get().incoming.some((c) => c.roomId === roomId)) acceptCall(roomId)
        else {
          ui.closeOverlays()
          chat.setView({ kind: 'dm', dmId: roomId })
        }
      })
      if (note) ringNotes.set(roomId, note)
    }
  })

  s.on('call:stop', ({ roomId }: { roomId: string }) => {
    closeRingNote(roomId)
    set((st) => ({ incoming: st.incoming.filter((c) => c.roomId !== roomId) }))
  })

  s.on('call:declined', ({ roomId, userId }: { roomId: string; userId: string }) => {
    if (get().roomId !== roomId) return
    const who = useChat.getState().users[userId]?.displayName ?? 'Собеседник'
    chat.toast({ title: 'Звонок отклонён', text: `${who} сейчас не может ответить` })
    const dm = useChat.getState().dms.find((d) => d.id === roomId)
    // в личке после отказа звонить больше некому — кладём трубку
    if (dm?.kind === 'dm' && (get().rooms[roomId]?.length ?? 0) <= 1) window.setTimeout(() => get().roomId === roomId && leaveVoice(), 1200)
  })

  s.on('call:unanswered', ({ roomId, declined }: { roomId: string; declined?: boolean }) => {
    if (get().roomId !== roomId) return
    set({ calling: null })
    // declined — все отказались: об этом уже сказали тосты «Звонок отклонён»
    if (!declined) chat.toast({ title: 'Никто не ответил', text: 'Можно оставить звонок открытым или положить трубку' })
  })
}

// Сервер, группа или канал пропали из списка — забываем, кто там сидел (иначе при возвращении покажем старое)
useChat.subscribe((s, prev) => {
  if (s.guilds === prev.guilds && s.dms === prev.dms) return
  // Права на видео забрали прямо во время звонка — гасим камеру и экран
  const { roomId: here, localCamera, localScreen } = get()
  if (here && (localCamera || localScreen) && !videoAllowed(here)) {
    if (localCamera) void toggleCamera()
    if (localScreen) void toggleScreen()
    chat.toast(NO_VIDEO)
  }
  const known = new Set([...s.guilds.flatMap((g) => g.channels.map((c) => c.id)), ...s.dms.map((d) => d.id)])
  const { rooms, roomId } = get()
  const stale = Object.keys(rooms).filter((id) => !known.has(id) && id !== roomId)
  if (!stale.length) return
  const next = { ...rooms }
  for (const id of stale) delete next[id]
  set({ rooms: next })
})

// Настройки меняются — движок подстраивается на лету (подписка одна на всё время работы вкладки)
useSettings.subscribe((s, prev) => {
  if (s.muted !== prev.muted || s.deafened !== prev.deafened) {
    sendState({ muted: s.muted || get().noMic, deafened: s.deafened })
    if (get().roomId) tone(s.muted || s.deafened ? 'mute' : 'unmute')
  }
  if (
    s.inputDeviceId !== prev.inputDeviceId ||
    s.noiseSuppression !== prev.noiseSuppression ||
    s.echoCancellation !== prev.echoCancellation ||
    s.autoGain !== prev.autoGain
  ) {
    if (get().roomId) void acquireMic()
  }
  if (s.outputDeviceId !== prev.outputDeviceId) void applySink()
  applyGate()
  applyVolumes()
  updateCalling()
  updateRingtone()
})

/** Человек печатает — буква «м» (V) должна попасть в текст, а не включить микрофон */
const typingInto = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || target.tagName === 'TEXTAREA' || (target.tagName === 'INPUT' && (target as HTMLInputElement).type !== 'range' && (target as HTMLInputElement).type !== 'checkbox'))

// «Нажми и говори»: клавиша из настроек (работает, пока окно Nuntius активно и курсор не в поле ввода)
window.addEventListener('keydown', (e) => {
  if (e.code !== useSettings.getState().pttKey || e.repeat || useSettings.getState().inputMode !== 'ptt' || !get().roomId || typingInto(e.target)) return
  pttDown = true
  applyGate()
})
window.addEventListener('keyup', (e) => {
  if (e.code !== useSettings.getState().pttKey || !pttDown) return
  pttDown = false
  applyGate()
})
window.addEventListener('blur', () => {
  if (!pttDown) return
  pttDown = false
  applyGate()
})
