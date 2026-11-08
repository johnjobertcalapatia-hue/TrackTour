import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import FoodImageCarousel from '@/features/tourist/components/FoodImageCarousel'

const IMAGES = ['foods/a.jpg', 'foods/b.jpg', 'foods/c.jpg']

function renderCarousel(images = IMAGES) {
  render(<FoodImageCarousel images={images} name="Chicken BBQ" popular />)
  return screen.getByRole('region', { name: 'Photos of Chicken BBQ' })
}

const activeSlide = () => screen.getAllByRole('group').find((g) => g.getAttribute('aria-roledescription') === 'slide' && g.getAttribute('aria-hidden') === 'false')
const trackTransform = () => screen.getByTestId('food-carousel-track').style.transform

function swipe(el: HTMLElement, dx: number, dy = 0) {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: 200, clientY: 100, pointerType: 'touch' })
  fireEvent.pointerMove(el, { pointerId: 1, clientX: 200 + dx / 2, clientY: 100 + dy / 2, pointerType: 'touch' })
  fireEvent.pointerMove(el, { pointerId: 1, clientX: 200 + dx, clientY: 100 + dy, pointerType: 'touch' })
  fireEvent.pointerUp(el, { pointerId: 1, clientX: 200 + dx, clientY: 100 + dy, pointerType: 'touch' })
}

describe('FoodImageCarousel', () => {
  it('renders every photo as a slide with the first one active', () => {
    renderCarousel()

    expect(activeSlide()).toHaveAttribute('aria-label', '1 of 3')
    expect(screen.getByText('1/3')).toBeInTheDocument()
    expect(screen.getByText('Popular')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Chicken BBQ' })).toBeInTheDocument()
    expect(trackTransform().replace("-0%", "0%")).toContain("calc(0% + 0px)")
  })

  it('next/previous buttons wrap around', () => {
    renderCarousel()

    fireEvent.click(screen.getByRole('button', { name: 'Previous image' }))
    expect(activeSlide()).toHaveAttribute('aria-label', '3 of 3')
    fireEvent.click(screen.getByRole('button', { name: 'Next image' }))
    expect(activeSlide()).toHaveAttribute('aria-label', '1 of 3')
    expect(trackTransform().replace("-0%", "0%")).toContain("calc(0% + 0px)")
  })

  it('swiping left/right changes the photo; small or vertical drags do not', () => {
    const region = renderCarousel()

    swipe(region, -120)
    expect(activeSlide()).toHaveAttribute('aria-label', '2 of 3')
    expect(trackTransform()).toContain('-100%')

    swipe(region, 120)
    expect(activeSlide()).toHaveAttribute('aria-label', '1 of 3')

    swipe(region, -10) // too small
    expect(activeSlide()).toHaveAttribute('aria-label', '1 of 3')

    swipe(region, -30, 160) // mostly vertical = page scroll
    expect(activeSlide()).toHaveAttribute('aria-label', '1 of 3')
  })

  it('supports keyboard arrows, dots and thumbnails', () => {
    const region = renderCarousel()

    fireEvent.keyDown(region, { key: 'ArrowRight' })
    expect(activeSlide()).toHaveAttribute('aria-label', '2 of 3')
    fireEvent.keyDown(region, { key: 'ArrowLeft' })
    expect(activeSlide()).toHaveAttribute('aria-label', '1 of 3')

    fireEvent.click(screen.getByRole('tab', { name: 'Show photo 3' }))
    expect(screen.getByRole('tab', { name: 'Show photo 3' })).toHaveAttribute('aria-selected', 'true')
    expect(activeSlide()).toHaveAttribute('aria-label', '3 of 3')

    const thumbs = within(screen.getByRole('group', { name: 'Food images' }))
    fireEvent.click(thumbs.getByRole('button', { name: 'View image 2 of 3' }))
    expect(thumbs.getByRole('button', { name: 'View image 2 of 3' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('2/3')).toBeInTheDocument()
  })

  it('a single photo shows no carousel controls', () => {
    renderCarousel(['foods/only.jpg'])

    expect(screen.getByRole('img', { name: 'Chicken BBQ' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next image' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tablist', { name: 'Choose photo' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Food images' })).not.toBeInTheDocument()
  })

  it('no photos shows the placeholder', () => {
    renderCarousel([])
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByTestId('food-carousel-track')).not.toBeInTheDocument()
  })

  it('plays restaurant videos in the carousel, with a video thumbnail', () => {
    render(<FoodImageCarousel images={['menu-items/plate.jpg', 'menu-items/sizzle.mp4']} name="Sisig" />)

    const video = screen.getByLabelText('Video of Sisig') as HTMLVideoElement
    expect(video.tagName).toBe('VIDEO')
    expect(video).toHaveAttribute('controls')
    expect(video).toHaveAttribute('playsinline')
    expect(video.getAttribute('src')).toContain('/storage/menu-items/sizzle.mp4')
    expect(screen.getByRole('button', { name: 'View video 2 of 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View image 1 of 2' })).toBeInTheDocument()
  })

  it('pauses a playing video when the tourist moves to another slide', () => {
    render(<FoodImageCarousel images={['menu-items/sizzle.mp4', 'menu-items/plate.jpg']} name="Sisig" />)
    const video = screen.getByLabelText('Video of Sisig') as HTMLVideoElement
    Object.defineProperty(video, 'paused', { configurable: true, get: () => false })
    const pause = vi.spyOn(video, 'pause').mockImplementation(() => {})

    fireEvent.click(screen.getByRole('button', { name: 'Next image' }))

    expect(pause).toHaveBeenCalled()
  })

  describe('videos autoplay on a loop', () => {
    const playSpy = () => vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())

    it('the video on the visible slide autoplays, muted and looping', () => {
      const play = playSpy()
      render(<FoodImageCarousel images={['menu-items/sizzle.mp4', 'menu-items/plate.jpg']} name="Sisig" />)

      const video = screen.getByLabelText('Video of Sisig') as HTMLVideoElement
      expect(video).toHaveAttribute('loop')
      expect(video.muted).toBe(true)
      expect(play).toHaveBeenCalledTimes(1)
      play.mockRestore()
    })

    it('starts playing when the tourist swipes to the video slide', () => {
      const play = playSpy()
      render(<FoodImageCarousel images={['menu-items/plate.jpg', 'menu-items/sizzle.mp4']} name="Sisig" />)
      expect(play).not.toHaveBeenCalled()

      fireEvent.click(screen.getByRole('button', { name: 'Next image' }))

      expect(play).toHaveBeenCalledTimes(1)
      play.mockRestore()
    })

    it('does not autoplay for people who prefer reduced motion', () => {
      const play = playSpy()
      const original = window.matchMedia
      window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener: () => {}, removeEventListener: () => {} })) as never
      try {
        render(<FoodImageCarousel images={['menu-items/sizzle.mp4']} name="Sisig" />)
        expect(play).not.toHaveBeenCalled()
        expect(screen.getByLabelText('Video of Sisig')).toHaveAttribute('controls')
      } finally {
        window.matchMedia = original
        play.mockRestore()
      }
    })
  })
})
