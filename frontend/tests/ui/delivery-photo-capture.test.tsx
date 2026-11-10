import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeliveryPhotoCapture } from '@/features/rider/components/DeliveryPhotoCapture'

/**
 * Drop-off proof (2026-11-09): "Open camera" shows the rear camera live in the
 * app; the rider takes a photo of the tourist receiving the food, checks it
 * and taps "Submit photo". Only the submitted photo reaches the parent (which
 * then enables "Confirm Delivered"). Without a live camera it falls back to
 * the phone's camera app, through the same review + Submit step.
 */

function fakeStream() {
  const track = { stop: vi.fn() }
  return { track, stream: { getTracks: () => [track] } as unknown as MediaStream }
}

function installCamera(getUserMedia: () => Promise<MediaStream>) {
  Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn(getUserMedia) }, configurable: true })
}

beforeEach(() => {
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:shot'), revokeObjectURL: vi.fn() }))
  // jsdom has no media/canvas: a 1280×720 frame and a JPEG blob stand in.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { value: 1280, configurable: true })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { value: 720, configurable: true })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ drawImage: vi.fn() }) as never)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (cb: BlobCallback) {
    cb(new Blob(['jpeg'], { type: 'image/jpeg' }))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'mediaDevices')
})

describe('DeliveryPhotoCapture', () => {
  it('opens the rear camera, takes the photo, and only "Submit photo" hands it over', async () => {
    const { stream, track } = fakeStream()
    installCamera(() => Promise.resolve(stream))
    const onSubmit = vi.fn()
    render(<DeliveryPhotoCapture photo={null} onSubmit={onSubmit} />)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open camera' })) })
    expect(screen.getByRole('dialog', { name: 'Delivery photo camera' })).toBeInTheDocument()
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith({ video: { facingMode: { ideal: 'environment' } }, audio: false })
    expect(screen.getByText('Photo of the tourist receiving the food')).toBeInTheDocument()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Take photo' })) })
    expect(screen.getByAltText('Photo preview')).toBeInTheDocument()
    expect(track.stop).toHaveBeenCalled() // camera released once the shot is taken
    expect(onSubmit).not.toHaveBeenCalled()

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Submit photo' })) })
    expect(onSubmit).toHaveBeenCalledTimes(1)
    const file = onSubmit.mock.calls[0]![0] as File
    expect(file.type).toBe('image/jpeg')
    expect(file.name).toMatch(/^delivery-proof-\d+\.jpg$/)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('Retake goes back to the live camera', async () => {
    const { stream } = fakeStream()
    installCamera(() => Promise.resolve(stream))
    render(<DeliveryPhotoCapture photo={null} onSubmit={vi.fn()} />)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open camera' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Take photo' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retake' })) })
    expect(screen.getByTestId('delivery-camera-video')).toBeInTheDocument()
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2)
  })

  it('closing the camera submits nothing and releases the camera', async () => {
    const { stream, track } = fakeStream()
    installCamera(() => Promise.resolve(stream))
    const onSubmit = vi.fn()
    render(<DeliveryPhotoCapture photo={null} onSubmit={onSubmit} />)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open camera' })) })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Close camera' })) })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(track.stop).toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('camera refused: explains and offers the phone camera app, whose photo is reviewed and submitted', async () => {
    installCamera(() => Promise.reject(new Error('NotAllowedError')))
    const onSubmit = vi.fn()
    render(<DeliveryPhotoCapture photo={null} onSubmit={onSubmit} />)

    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Open camera' })) })
    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't open the camera")
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Use phone camera app' })).toBeInTheDocument()

    const photo = new File(['x'], 'camera-app.jpg', { type: 'image/jpeg' })
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Take a photo of the tourist receiving the food'), { target: { files: [photo] } })
    })
    expect(screen.getByAltText('Photo preview')).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Submit photo' })) })
    expect(onSubmit).toHaveBeenCalledWith(photo)
  })

  it('no live camera in this browser: "Open camera" goes straight to the phone camera app', async () => {
    const onSubmit = vi.fn()
    render(<DeliveryPhotoCapture photo={null} onSubmit={onSubmit} />)
    const input = screen.getByLabelText('Take a photo of the tourist receiving the food') as HTMLInputElement
    expect(input).toHaveAttribute('capture', 'environment')
    const click = vi.spyOn(input, 'click')

    fireEvent.click(screen.getByRole('button', { name: 'Open camera' }))
    expect(click).toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('a submitted photo shows as submitted, with Retake', () => {
    const photo = new File(['x'], 'p.jpg', { type: 'image/jpeg' })
    render(<DeliveryPhotoCapture photo={photo} onSubmit={vi.fn()} />)
    expect(screen.getByText('Photo submitted')).toBeInTheDocument()
    expect(screen.getByAltText('Submitted delivery photo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Retake/ })).toBeInTheDocument()
  })
})
