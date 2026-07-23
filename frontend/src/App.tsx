/**
 * App — root component with React Router configuration.
 *
 * Routes:
 *   /                          — Dashboard (list discussions)
 *   /create                    — Create a new discussion
 *   /discussion/:id/confirm    — Confirm generated panelists
 *   /discussion/:id            — Studio room (three-column layout)
 */

import { BrowserRouter, Routes, Route } from "react-router-dom";
import DashboardPage from "./pages/DashboardPage.js";
import CreateDiscussionPage from "./pages/CreateDiscussionPage.js";
import ConfirmPanelistsPage from "./pages/ConfirmPanelistsPage.js";
import DiscussionRoomPage from "./pages/DiscussionRoomPage.js";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/create" element={<CreateDiscussionPage />} />
        <Route path="/discussion/:id/confirm" element={<ConfirmPanelistsPage />} />
        <Route path="/discussion/:id" element={<DiscussionRoomPage />} />
      </Routes>
    </BrowserRouter>
  );
}
