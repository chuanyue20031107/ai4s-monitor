import { Routes, Route } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Ai4sProvider } from "@/store/Ai4sStore";
import DashboardPage from "@/pages/DashboardPage/DashboardPage";
import ArticlesPage from "@/pages/ArticlesPage/ArticlesPage";
import ArticleDetailPage from "@/pages/ArticleDetailPage/ArticleDetailPage";
import SourcesPage from "@/pages/SourcesPage/SourcesPage";
import RunsPage from "@/pages/RunsPage/RunsPage";
import SettingsPage from "@/pages/SettingsPage/SettingsPage";
import NotFoundPage from "@/pages/NotFoundPage/NotFoundPage";

export default function App() {
  return (
    <Ai4sProvider>
      <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="articles" element={<ArticlesPage />} />
        <Route path="articles/:id" element={<ArticleDetailPage />} />
        <Route path="sources" element={<SourcesPage />} />
        <Route path="runs" element={<RunsPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Ai4sProvider>
  );
}
