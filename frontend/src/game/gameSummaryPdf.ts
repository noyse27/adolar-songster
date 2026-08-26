import { GameState } from './types';
import { ORBITRON_BOLD_BASE64, ORBITRON_REGULAR_BASE64 } from './fonts/orbitron';

function initials(username: string): string {
  const parts = username.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return username.slice(0, 2).toUpperCase();
}

// Adolar-Branding (frontend/src/styles/brand.css) als RGB-Tripel, da jsPDF
// keine CSS-Variablen kennt - bei einer Palettenaenderung dort mitziehen.
const NAVY: [number, number, number] = [21, 17, 61]; // --adolar-navy
const CYAN: [number, number, number] = [49, 213, 255]; // --adolar-cyan
const LAVENDER: [number, number, number] = [169, 139, 255]; // --adolar-lavender
const WHITE: [number, number, number] = [255, 255, 255]; // --adolar-white
const VIOLET: [number, number, number] = [110, 68, 255]; // --adolar-violet

// One PDF summary of a finished match, downloaded straight from the
// winner screen (see LiveGameBoard.tsx) - client-side with jsPDF since all
// the data (players, ranks, points, timelines) is already sitting in the
// GameState the winner screen renders from, no extra backend round-trip
// needed. jsPDF is dynamically imported so its ~230kB (it pulls in
// html2canvas as an optional dep) only loads for someone who actually
// clicks "Als PDF speichern", not on every page's initial bundle.
export async function buildGameSummaryPdf(state: GameState): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 18;
  let y = 20;

  // Orbitron fuer Ueberschriften, passend zum Marken-Font-Stack in
  // brand.css - Fliesstext bleibt bei jsPDF's eingebautem helvetica (kein
  // lizenzfrei einbettbares Segoe-UI-Aequivalent, deckt sich mit dem
  // CSS-Fallback 'sans-serif').
  doc.addFileToVFS('Orbitron-Regular.ttf', ORBITRON_REGULAR_BASE64);
  doc.addFont('Orbitron-Regular.ttf', 'Orbitron', 'normal');
  doc.addFileToVFS('Orbitron-Bold.ttf', ORBITRON_BOLD_BASE64);
  doc.addFont('Orbitron-Bold.ttf', 'Orbitron', 'bold');

  function paintBackground(): void {
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, pageWidth, pageHeight, 'F');
  }

  function newPage(): void {
    doc.addPage();
    paintBackground();
    y = 20;
  }

  paintBackground();

  const winner = state.players.find((p) => p.userId === state.winnerUserId);
  const playedOn = state.matchEndedAt ? new Date(state.matchEndedAt) : new Date();
  const roundCount = state.currentRound?.indexNo ?? 0;

  doc.setFont('Orbitron', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...CYAN);
  doc.text('Adolar Songster', marginX, y);
  y += 10;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(...WHITE);
  doc.text(`Spiel vom ${playedOn.toLocaleDateString('de-DE')}`, marginX, y);
  y += 7;
  doc.text(`Anzahl Runden: ${roundCount}`, marginX, y);
  y += 7;

  doc.setFontSize(9);
  doc.setTextColor(...LAVENDER);
  doc.text(`Tisch-ID: ${state.tableId}`, marginX, y);
  y += 5;
  doc.text(`Playlist-ID: ${state.playlistId}`, marginX, y);
  y += 9;

  doc.setFont('Orbitron', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...LAVENDER);
  doc.text('Spieler:', marginX, y);
  y += 7;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(...WHITE);
  const standings = [...state.players].sort((a, b) => b.timeline.length - a.timeline.length);
  for (const p of standings) {
    doc.text(
      `${p.username} (#${p.globalRank})  ${p.scorePoints} Songster-Punkte / ${p.karmaPoints} Karmapunkte / ${p.gamesPlayed} gespielte Spiele`,
      marginX,
      y,
    );
    y += 6;
  }
  y += 6;

  doc.setFont('Orbitron', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...CYAN);
  doc.text(`Sieger: ${winner?.username ?? 'Unentschieden'}`, marginX, y);
  y += 12;

  // Initials box + timeline of year-cards, one row per player.
  const boxSize = 10;
  const cardWidth = 16;
  const cardHeight = 10;
  const cardGap = 2;

  doc.setFontSize(9);
  for (const p of state.players) {
    if (y > 270) {
      newPage();
    }
    doc.setFont('Orbitron', 'bold');
    doc.setDrawColor(...VIOLET);
    doc.setTextColor(...WHITE);
    doc.rect(marginX, y, boxSize, boxSize);
    doc.text(initials(p.username), marginX + boxSize / 2, y + boxSize / 2 + 1.2, { align: 'center', baseline: 'middle' });

    doc.setFont('helvetica', 'normal');
    let cardX = marginX + boxSize + 6;
    for (const year of p.timeline) {
      if (cardX + cardWidth > 190) {
        cardX = marginX + boxSize + 6;
        y += cardHeight + cardGap;
        if (y > 270) {
          newPage();
        }
      }
      doc.rect(cardX, y, cardWidth, cardHeight);
      doc.text(String(year), cardX + cardWidth / 2, y + cardHeight / 2 + 1, { align: 'center', baseline: 'middle' });
      cardX += cardWidth + cardGap;
    }
    y += boxSize + 6;
  }

  doc.save(`songster-spiel-${playedOn.toISOString().slice(0, 10)}.pdf`);
}
