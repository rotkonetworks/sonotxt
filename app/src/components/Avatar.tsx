// Live2D avatar driven by webcam face tracking via MediaPipe
// Supports both local tracking (webcam) and remote params (from peer stream)

import { onMount, onCleanup, createSignal, createEffect, Show } from 'solid-js'
import * as PIXI from 'pixi.js'
import { Live2DModel } from 'pixi-live2d-display/cubism4'
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

export interface AvatarParams {
  [key: string]: number
}

interface Props {
  /** Path to .model3.json */
  modelPath?: string
  width?: number
  height?: number
  /** Whether to actively track from webcam (set false to freeze or use remote) */
  active?: boolean
  /** Lip sync intensity override (0-1) */
  mouthOpen?: number
  /** If provided, use these params instead of webcam tracking (for peer avatar) */
  remoteParams?: AvatarParams
  /** Callback with computed params each frame (for streaming to peer) */
  onParams?: (params: AvatarParams) => void
}

// MediaPipe ARKit blendshape → Live2D parameter mapping
function mapBlendshapes(
  blendshapes: { categoryName: string; score: number }[],
  mouthOverride?: number
): AvatarParams {
  const bs: Record<string, number> = {}
  for (const b of blendshapes) bs[b.categoryName] = b.score

  const jawOpen = bs['jawOpen'] ?? 0
  const mouthSmileL = bs['mouthSmileLeft'] ?? 0
  const mouthSmileR = bs['mouthSmileRight'] ?? 0

  return {
    ParamEyeLOpen: 1 - (bs['eyeBlinkLeft'] ?? 0),
    ParamEyeROpen: 1 - (bs['eyeBlinkRight'] ?? 0),
    ParamEyeBallX: ((bs['eyeLookOutLeft'] ?? 0) - (bs['eyeLookInLeft'] ?? 0)) * 2,
    ParamEyeBallY: ((bs['eyeLookUpLeft'] ?? 0) - (bs['eyeLookDownLeft'] ?? 0)) * 2,
    ParamBrowLY: (bs['browOuterUpLeft'] ?? 0) - (bs['browDownLeft'] ?? 0),
    ParamBrowRY: (bs['browOuterUpRight'] ?? 0) - (bs['browDownRight'] ?? 0),
    ParamMouthOpenY: mouthOverride ?? jawOpen,
    ParamMouthForm: (mouthSmileL + mouthSmileR) / 2,
    ParamAngleX: 0,
    ParamAngleY: 0,
    ParamAngleZ: 0,
  }
}

function matrixToAngles(m: Float32Array): { yaw: number; pitch: number; roll: number } {
  const r02 = m[8], r10 = m[1], r11 = m[5], r12 = m[9], r22 = m[10]
  const pitch = Math.asin(-r12)
  const yaw = Math.atan2(r02, r22)
  const roll = Math.atan2(r10, r11)
  const toDeg = 180 / Math.PI
  return { yaw: yaw * toDeg, pitch: pitch * toDeg, roll: roll * toDeg }
}

function applyParams(model: any, params: AvatarParams) {
  const coreModel = model?.internalModel?.coreModel
  if (!coreModel) return
  for (const [param, value] of Object.entries(params)) {
    try { coreModel.setParameterValueById(param, value) } catch {}
  }
}

export default function Avatar(props: Props) {
  const [ready, setReady] = createSignal(false)
  const [error, setError] = createSignal('')
  let containerRef: HTMLDivElement | undefined
  let app: PIXI.Application | null = null
  let model: any = null
  let faceLandmarker: FaceLandmarker | null = null
  let video: HTMLVideoElement | null = null
  let animFrame = 0
  let stopped = false

  const isRemote = () => !!props.remoteParams
  const width = () => props.width ?? 300
  const height = () => props.height ?? 400

  onMount(async () => {
    if (!containerRef) return
    try {
      app = new PIXI.Application({
        width: width(),
        height: height(),
        backgroundAlpha: 0,
        autoStart: true,
      })
      containerRef.appendChild(app.view as HTMLCanvasElement)

      const modelPath = props.modelPath || '/live2d/haru/haru.model3.json'
      model = await Live2DModel.from(modelPath, { autoInteract: false })
      model.scale.set(0.15)
      model.anchor.set(0.5, 0.5)
      model.x = width() / 2
      model.y = height() / 2
      app.stage.addChild(model)

      const bounds = model.getBounds()
      if (bounds.width > 0 && bounds.height > 0) {
        const scaleX = (width() * 0.9) / bounds.width
        const scaleY = (height() * 0.9) / bounds.height
        model.scale.set(Math.min(scaleX, scaleY))
      }

      if (!isRemote()) {
        // Local mode: init webcam + MediaPipe
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        )
        faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
          numFaces: 1,
        })

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: 'user' },
        })
        video = document.createElement('video')
        video.srcObject = stream
        video.autoplay = true
        video.playsInline = true
        video.muted = true
        await video.play()

        trackingLoop()
      }

      setReady(true)
    } catch (err) {
      setError(`${err}`)
    }
  })

  // Apply remote params reactively
  createEffect(() => {
    const p = props.remoteParams
    if (p && model) applyParams(model, p)
  })

  function trackingLoop() {
    if (stopped) return

    if (video && faceLandmarker && model && video.readyState >= 2) {
      if (props.active !== false) {
        const result = faceLandmarker.detectForVideo(video, performance.now())

        if (result.faceBlendshapes?.[0]) {
          const params = mapBlendshapes(
            result.faceBlendshapes[0].categories,
            props.mouthOpen
          )

          if (result.facialTransformationMatrixes?.[0]) {
            const angles = matrixToAngles(result.facialTransformationMatrixes[0].data as Float32Array)
            params.ParamAngleX = angles.yaw
            params.ParamAngleY = angles.pitch
            params.ParamAngleZ = angles.roll
          }

          applyParams(model, params)
          props.onParams?.(params)
        }
      }
    }

    animFrame = requestAnimationFrame(trackingLoop)
  }

  onCleanup(() => {
    stopped = true
    cancelAnimationFrame(animFrame)
    if (video?.srcObject) (video.srcObject as MediaStream).getTracks().forEach(t => t.stop())
    video = null
    faceLandmarker?.close()
    faceLandmarker = null
    model?.destroy()
    app?.destroy(true)
    app = null
  })

  return (
    <div class="relative" style={{ width: `${width()}px`, height: `${height()}px` }}>
      <div ref={containerRef} class="w-full h-full" />
      <Show when={!ready() && !error()}>
        <div class="absolute inset-0 flex items-center justify-center">
          <span class="text-accent font-heading text-xs uppercase tracking-wider animate-pulse">
            Loading avatar...
          </span>
        </div>
      </Show>
      <Show when={error()}>
        <div class="absolute inset-0 flex items-center justify-center">
          <span class="text-red-500 font-mono text-xs text-center px-2">
            {error()}
          </span>
        </div>
      </Show>
    </div>
  )
}
