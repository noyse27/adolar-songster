import { Route, Routes } from 'react-router-dom';
import { SetupWizard } from './components/SetupWizard';
import { RootGate } from './pages/RootGate';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { InstructionsPage } from './pages/InstructionsPage';
import { ProfilePage } from './pages/ProfilePage';
import { AdminPage } from './pages/AdminPage';
import { InvitesPage } from './pages/InvitesPage';
import { LobbyPage } from './pages/LobbyPage';
import { CreateTablePage } from './pages/CreateTablePage';
import { TableRoomPage } from './pages/TableRoomPage';
import { Playboard } from './playboard/Playboard';
import { LiveGameBoard } from './game/LiveGameBoard';

// TODO(popup): "/spiel/:gameId" still opens in the same tab/window as the
// rest of the app. Launching it as its own popup window on round-start is
// still open (see Playboard UI spec section 8). "/playboard" stays as the
// original disconnected local-state prototype/design reference.
export function App() {
  return (
    <Routes>
      <Route path="/" element={<RootGate />} />
      <Route path="/setup" element={<SetupWizard />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/anleitung" element={<InstructionsPage />} />
      <Route path="/profil" element={<ProfilePage />} />
      <Route path="/admin" element={<AdminPage />} />
      <Route path="/einladungen" element={<InvitesPage />} />
      <Route path="/lobby" element={<LobbyPage />} />
      <Route path="/tisch/neu" element={<CreateTablePage />} />
      <Route path="/tisch/:tableId" element={<TableRoomPage />} />
      <Route path="/spiel/:gameId" element={<LiveGameBoard />} />
      <Route path="/playboard" element={<Playboard />} />
    </Routes>
  );
}
