import { Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import Ask from "./pages/Ask";
import DataPage from "./pages/DataPage";
import Diagnosis from "./pages/Diagnosis";
import Experiments from "./pages/Experiments";
import Home from "./pages/Home";
import Memory from "./pages/Memory";
import Plan from "./pages/Plan";
import Priorities from "./pages/Priorities";
import Trail from "./pages/Trail";

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/diagnosis" element={<Diagnosis />} />
        <Route path="/diagnosis/:findingId" element={<Diagnosis />} />
        <Route path="/priorities" element={<Priorities />} />
        <Route path="/plan" element={<Plan />} />
        <Route path="/experiments" element={<Experiments />} />
        <Route path="/ask" element={<Ask />} />
        <Route path="/memory" element={<Memory />} />
        <Route path="/data" element={<DataPage />} />
        <Route path="/trail" element={<Trail />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </Layout>
  );
}
