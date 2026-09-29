// Fixed manifest of synthetic demo songs. Every filename here must match a
// clip actually rendered by demo/generate-library.sh (kept in sync by hand
// - the generator's own comment points back here). Titles/artists are
// invented, so there's no copyright question about serving them from a
// public demo; years are spread across seven decades since the game is
// fundamentally about placing songs on a year timeline, and a narrow
// spread would make every round trivially easy.
export interface DemoSong {
  title: string;
  year: number;
  durationSec: number;
  filename: string;
}

export const DEMO_SONGS: DemoSong[] = [
  { title: 'Fading Radio Waves', year: 1965, durationSec: 25, filename: 'fading-radio-waves.mp3' },
  { title: 'Copper Sky Motel', year: 1971, durationSec: 25, filename: 'copper-sky-motel.mp3' },
  { title: 'Velvet Highway', year: 1976, durationSec: 25, filename: 'velvet-highway.mp3' },
  { title: 'Neon Rainfall', year: 1982, durationSec: 25, filename: 'neon-rainfall.mp3' },
  { title: 'Static & Satellites', year: 1985, durationSec: 25, filename: 'static-and-satellites.mp3' },
  { title: 'Paper Boats', year: 1989, durationSec: 25, filename: 'paper-boats.mp3' },
  { title: 'Glasshouse Parade', year: 1993, durationSec: 25, filename: 'glasshouse-parade.mp3' },
  { title: 'Dial-Up Sunrise', year: 1997, durationSec: 25, filename: 'dial-up-sunrise.mp3' },
  { title: 'Concrete Orchard', year: 2001, durationSec: 25, filename: 'concrete-orchard.mp3' },
  { title: 'Low Battery Blues', year: 2005, durationSec: 25, filename: 'low-battery-blues.mp3' },
  { title: 'Tangerine Static', year: 2008, durationSec: 25, filename: 'tangerine-static.mp3' },
  { title: 'Borrowed Umbrellas', year: 2011, durationSec: 25, filename: 'borrowed-umbrellas.mp3' },
  { title: 'Nightbus Constellation', year: 2014, durationSec: 25, filename: 'nightbus-constellation.mp3' },
  { title: 'Slow Motion Fireworks', year: 2017, durationSec: 25, filename: 'slow-motion-fireworks.mp3' },
  { title: 'Afterglow Archive', year: 2020, durationSec: 25, filename: 'afterglow-archive.mp3' },
  { title: 'Quiet Static Kingdom', year: 2023, durationSec: 25, filename: 'quiet-static-kingdom.mp3' },
];
