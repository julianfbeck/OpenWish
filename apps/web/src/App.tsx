import { Route, Routes } from "react-router-dom";

import { AdminPage } from "./components/AdminPage";
import { HomePage } from "./components/HomePage";
import { PublicProjectPage } from "./components/PublicProjectPage";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/projects/:slug" element={<PublicProjectPage />} />
      <Route path="/admin/:slug" element={<AdminPage />} />
    </Routes>
  );
}
