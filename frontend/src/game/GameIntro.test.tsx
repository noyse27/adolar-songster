import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { GameIntro } from './GameIntro';

describe('GameIntro', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T12:00:00Z'));
    // jsdom implementiert HTMLMediaElement.play() nicht.
    vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('zeigt das Intro direkt nach dem Spielstart', () => {
    render(<GameIntro gameStartedAt={new Date().toISOString()} />);
    expect(screen.getByText('APP wird geladen…')).toBeInTheDocument();
  });

  it('zeigt das Intro nicht mehr, wenn der Spielstart schon laenger her ist', () => {
    const startedAt = new Date(Date.now() - 20_000).toISOString();
    const { container } = render(<GameIntro gameStartedAt={startedAt} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('blendet sich nach 13 Sekunden selbst aus', () => {
    const { container } = render(<GameIntro gameStartedAt={new Date().toISOString()} />);
    act(() => {
      vi.advanceTimersByTime(13_100);
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('blendet sich aus, wenn das Video nicht geladen werden kann', () => {
    const { container } = render(<GameIntro gameStartedAt={new Date().toISOString()} />);
    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    fireEvent.error(video!);
    expect(container).toBeEmptyDOMElement();
  });
});
